import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import { ManuscriptFormat } from "@prisma/client";
import { hashText } from "@/lib/compiler/hash";
import {
  createImportManifest,
  warning
} from "@/lib/import/v2/manifest";
import {
  DOCX_IMPORT_PARSER_VERSION,
  type ImportHeadingType,
  type ImportManifest,
  type ImportWarning,
  type ManuscriptIRBlock
} from "@/lib/import/v2/types";
import { countWords } from "@/lib/text/wordCount";

const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const CHAPTER_HEADING =
  /^(chapter|kapitel)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|ett|en|tv\u00e5|tva|tre|fyra|fem|sex|sju|\u00e5tta|atta|nio|tio)(?=$|[\s:.\-])[:.\-\s]*(.*)$/iu;
const SWEDISH_ORDINAL_CHAPTER =
  /^(f\u00f6rsta|forsta|andra|tredje|fj\u00e4rde|fjarde|femte|sj\u00e4tte|sjatte|sjunde|\u00e5ttonde|attonde|nionde|tionde)\s+kapitlet(?:\s*[:.\-]\s*(.*))?$/iu;
const STANDALONE_DIGITS = /^([0-9]{1,3})[.)]?$/u;
const STANDALONE_ROMAN =
  /^(?=[ivxlcdm]{1,8}[.)]?$)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})[.)]?$/iu;
const NAMED_FRONT_BACK = /^(prologue|prolog|epilogue|epilog)$/iu;
const SCENE_BREAK = /^(\*{3,}|#{1,3}|-{3,}|~{3,}|\u00a7)$/u;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  textNodeName: "#text",
  trimValues: false
});

type DocxParagraphRef = {
  value: Record<string, unknown>;
  path: string;
  paragraphIndex: number;
  inTable: boolean;
};

export async function parseDocxToImportManifest(input: {
  buffer: Buffer;
  sourceFileName: string;
  sourceMimeType?: string;
  parserVersion?: string;
}): Promise<ImportManifest> {
  const zip = new AdmZip(input.buffer);
  const documentXml = readZipText(zip, "word/document.xml");
  if (!documentXml) {
    throw new Error("DOCX file is missing word/document.xml.");
  }

  const styles = parseStyles(readZipText(zip, "word/styles.xml"));
  const comments = parseComments(readZipText(zip, "word/comments.xml"));
  const parsed = parser.parse(documentXml);
  const body = record(parsed.document).body;
  const paragraphs = collectParagraphs(body, "word/document.xml/body");
  const standaloneRomanChapterParagraphs =
    findSequentialStandaloneRomanParagraphs(paragraphs);
  const blocks: Array<
    Omit<ManuscriptIRBlock, "textHash" | "warnings"> & {
      warnings?: ImportWarning[];
    }
  > = [];
  const manifestWarnings: ImportWarning[] = [];
  let characterOffset = 0;
  let tableParagraphCount = 0;

  for (const [index, paragraph] of paragraphs.entries()) {
    const p = paragraph.value;
    const styleId = stringValue(record(record(p.pPr).pStyle).val);
    const styleName = styleId ? styles.get(styleId) : undefined;
    const text = extractParagraphText(p).trim();
    const pageBreak = hasPageBreak(p);
    const commentIds = collectIds(p, "commentReference");
    const hasTrackedChange = containsKey(p, "ins") || containsKey(p, "del");
    if (paragraph.inTable) {
      tableParagraphCount += 1;
    }
    const blockWarnings = [
      ...commentIds.map((commentId) =>
        warning({
          code: "docx_comment",
          message: "DOCX paragraph has an attached comment.",
          severity: "info",
          metadata: {
            commentId,
            comment: comments.get(commentId)
          }
        })
      )
    ];

    if (hasTrackedChange) {
      blockWarnings.push(
        warning({
          code: "docx_track_changes",
          message: "DOCX paragraph includes tracked changes; inserted text is included and deleted text is ignored.",
          severity: "warning"
        })
      );
    }

    if (pageBreak) {
      blockWarnings.push(
        warning({
          code: "docx_page_break",
          message: "DOCX paragraph includes a page break.",
          severity: "info"
        })
      );
    }

    if (!text && pageBreak) {
      blocks.push({
        id: `docx-${index + 1}`,
        order: blocks.length + 1,
        type: "page_break" as const,
        text: "",
        sourceAnchor: {
          sourceFileName: input.sourceFileName,
          sourceFormat: ManuscriptFormat.DOCX,
          path: paragraph.path,
          paragraphIndex: paragraph.paragraphIndex,
          styleId,
          styleName
        },
        offset: {
          blockIndex: blocks.length,
          paragraphIndex: paragraph.paragraphIndex,
          characterStart: characterOffset,
          characterEnd: characterOffset
        },
        confidence: 0.9,
        warnings: blockWarnings,
        metadata: paragraph.inTable ? { docxContainer: "table" } : undefined
      });
      continue;
    }

    if (!text) {
      continue;
    }

    const list = listInfo(p);
    const styledHeadingLevel = headingLevelFromStyle(styleId, styleName);
    const inferredHeading = !list
      ? inferUnstyledHeading(
          text,
          paragraph.inTable,
          standaloneRomanChapterParagraphs.has(paragraph.paragraphIndex)
        )
      : null;
    const headingLevel = styledHeadingLevel ?? inferredHeading?.headingLevel;
    const sceneBreak = SCENE_BREAK.test(text.trim());
    const type = sceneBreak
      ? "scene_break"
      : headingLevel
        ? "heading"
        : list
          ? "list_item"
          : isTitleStyle(styleId, styleName)
            ? "title"
            : "paragraph";
    const headingType =
      type === "scene_break"
        ? "scene"
        : type === "title"
        ? "title"
        : headingLevel
          ? inferredHeading?.headingType ?? headingTypeFromText(text, headingLevel)
          : undefined;
    const start = characterOffset;
    const end = start + text.length;
    const warnings =
      inferredHeading && !styledHeadingLevel
        ? [
            ...blockWarnings,
            warning({
              code: "docx_unstyled_heading",
              message:
                "DOCX paragraph was treated as a heading based on its text because no heading style was present.",
              severity: "info",
              confidence: inferredHeading.confidence
            })
          ]
        : blockWarnings;

    blocks.push({
      id: `docx-${index + 1}`,
      order: blocks.length + 1,
      type,
      text,
      headingLevel: headingLevel ?? (type === "title" ? 0 : undefined),
      headingType,
      sourceAnchor: {
        sourceFileName: input.sourceFileName,
        sourceFormat: ManuscriptFormat.DOCX,
        path: paragraph.path,
        paragraphIndex: paragraph.paragraphIndex,
        styleId,
        styleName
      },
      offset: {
        blockIndex: blocks.length,
        paragraphIndex: paragraph.paragraphIndex,
        characterStart: start,
        characterEnd: end
      },
      confidence: confidenceForDocxBlock(type, headingType),
      list,
      pageBreakBefore: pageBreak,
      warnings,
      metadata: paragraph.inTable ? { docxContainer: "table" } : undefined
    });

    characterOffset = end + 2;
  }

  if (blocks.length === 0) {
    manifestWarnings.push(
      warning({
        code: "docx_no_paragraphs",
        message: "No readable paragraphs were found in the DOCX.",
        severity: "critical"
      })
    );
  }

  return createImportManifest({
    parserVersion: input.parserVersion ?? DOCX_IMPORT_PARSER_VERSION,
    sourceFileName: input.sourceFileName,
    sourceMimeType: input.sourceMimeType ?? DOCX_MIME_TYPE,
    sourceFormat: ManuscriptFormat.DOCX,
    fileHash: hashText(input.buffer.toString("base64")),
    blocks,
    warnings: manifestWarnings,
    metadata: {
      structuredDocx: true,
      paragraphCount: paragraphs.length,
      tableParagraphCount,
      styleCount: styles.size,
      commentCount: comments.size
    }
  });
}

function collectParagraphs(
  value: unknown,
  path: string,
  inTable = false,
  output: DocxParagraphRef[] = []
): DocxParagraphRef[] {
  if (!value || typeof value !== "object") {
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectParagraphs(item, `${path}[${index + 1}]`, inTable, output)
    );
    return output;
  }

  const item = record(value);
  for (const [key, child] of Object.entries(item)) {
    if (key === "p") {
      for (const [index, paragraph] of asArray(child).entries()) {
        output.push({
          value: record(paragraph),
          path: `${path}/p[${index + 1}]`,
          paragraphIndex: output.length,
          inTable
        });
      }
      continue;
    }

    if (key === "tbl" || key === "tr" || key === "tc") {
      collectParagraphs(child, `${path}/${key}`, true, output);
      continue;
    }

    if (key !== "pPr" && key !== "rPr") {
      collectParagraphs(child, `${path}/${key}`, inTable, output);
    }
  }

  return output;
}

function parseStyles(xml: string | null) {
  const styles = new Map<string, string>();
  if (!xml) {
    return styles;
  }

  const parsed = parser.parse(xml);
  for (const style of asArray(record(record(parsed.styles).style))) {
    const item = record(style);
    const styleId = stringValue(item.styleId);
    const name = stringValue(record(item.name).val);
    if (styleId && name) {
      styles.set(styleId, name);
    }
  }

  return styles;
}

function parseComments(xml: string | null) {
  const comments = new Map<string, string>();
  if (!xml) {
    return comments;
  }

  const parsed = parser.parse(xml);
  for (const comment of asArray(record(record(parsed.comments).comment))) {
    const item = record(comment);
    const id = stringValue(item.id);
    const text = extractParagraphText(item).trim();
    if (id) {
      comments.set(id, text);
    }
  }

  return comments;
}

function readZipText(zip: AdmZip, path: string) {
  const entry = zip.getEntry(path);
  return entry ? zip.readAsText(entry) : null;
}

function extractParagraphText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(extractParagraphText).join("");
  }

  const item = record(value);
  let text = "";

  for (const [key, child] of Object.entries(item)) {
    if (key === "del" || key === "delText") {
      continue;
    }

    if (key === "t" || key === "#text") {
      text += extractParagraphText(child);
      continue;
    }

    if (key === "tab") {
      text += "\t";
      continue;
    }

    if (key === "br") {
      text += "\n";
      continue;
    }

    if (
      key === "r" ||
      key === "hyperlink" ||
      key === "smartTag" ||
      key === "ins" ||
      key === "comment"
    ) {
      text += extractParagraphText(child);
    }
  }

  return text;
}

function hasPageBreak(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(hasPageBreak);
  }

  const item = record(value);
  if (item.lastRenderedPageBreak !== undefined) {
    return true;
  }

  const br = item.br;
  if (br !== undefined) {
    return asArray(br).some((candidate) => {
      const recordValue = record(candidate);
      return recordValue.type === "page" || recordValue.val === "page";
    });
  }

  return Object.values(item).some(hasPageBreak);
}

function collectIds(value: unknown, keyName: string): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectIds(item, keyName));
  }

  const item = record(value);
  const ids: string[] = [];

  for (const [key, child] of Object.entries(item)) {
    if (key === keyName) {
      for (const candidate of asArray(child)) {
        const id = stringValue(record(candidate).id);
        if (id) {
          ids.push(id);
        }
      }
      continue;
    }

    ids.push(...collectIds(child, keyName));
  }

  return ids;
}

function containsKey(value: unknown, keyName: string): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsKey(item, keyName));
  }

  const item = record(value);
  return keyName in item || Object.values(item).some((child) => containsKey(child, keyName));
}

function headingLevelFromStyle(styleId?: string, styleName?: string) {
  const label = `${styleId ?? ""} ${styleName ?? ""}`;
  const match =
    label.match(/\bheading\s*([1-6])\b/i) ??
    label.match(/\brubrik\s*([1-6])\b/i);
  return match ? Number(match[1]) : null;
}

function isTitleStyle(styleId?: string, styleName?: string) {
  const label = `${styleId ?? ""} ${styleName ?? ""}`.toLowerCase();
  return /\btitle\b|\btitel\b|\bsubtitle\b|\bundertitel\b/.test(label);
}

function headingTypeFromText(
  text: string,
  headingLevel: number
): ImportHeadingType {
  const trimmed = text.trim();
  if (/^(prologue|prolog|epilogue|epilog)$/iu.test(trimmed)) {
    return "front_matter";
  }

  if (/^(chapter|kapitel)\b/iu.test(trimmed) || /^([0-9]{1,3}|[ivxlcdm]+)[.)]?$/iu.test(trimmed)) {
    return "chapter";
  }

  if (/\b(scene|scen)\b/iu.test(trimmed)) {
    return "scene";
  }

  if (headingLevel === 1) {
    return "chapter";
  }

  return headingLevel === 2 ? "section" : "unknown";
}

function inferUnstyledHeading(
  text: string,
  inTable: boolean,
  romanSequenceCandidate = false
) {
  if (inTable) {
    return null;
  }

  const trimmed = text.trim();
  const wordCount = countWords(trimmed);

  if (wordCount === 0 || wordCount > 16 || trimmed.length > 120) {
    return null;
  }

  if (CHAPTER_HEADING.test(trimmed) || SWEDISH_ORDINAL_CHAPTER.test(trimmed)) {
    return {
      confidence: 0.88,
      headingType: "chapter" as const,
      headingLevel: 1
    };
  }

  if (NAMED_FRONT_BACK.test(trimmed)) {
    return {
      confidence: 0.86,
      headingType: "front_matter" as const,
      headingLevel: 1
    };
  }

  if (
    STANDALONE_DIGITS.test(trimmed) ||
    (romanSequenceCandidate && STANDALONE_ROMAN.test(trimmed))
  ) {
    return {
      confidence: 0.72,
      headingType: "chapter" as const,
      headingLevel: 1
    };
  }

  if (/^(scene|scen)\b/iu.test(trimmed)) {
    return {
      confidence: 0.82,
      headingType: "scene" as const,
      headingLevel: 2
    };
  }

  return null;
}

function findSequentialStandaloneRomanParagraphs(paragraphs: DocxParagraphRef[]) {
  const starts = new Set<number>();
  const candidates = paragraphs
    .map((paragraph) => {
      if (paragraph.inTable) {
        return null;
      }

      const value = standaloneRomanValue(
        extractParagraphText(paragraph.value).trim()
      );

      return value
        ? { paragraphIndex: paragraph.paragraphIndex, value }
        : null;
    })
    .filter(
      (
        candidate
      ): candidate is { paragraphIndex: number; value: number } =>
        Boolean(candidate)
    );
  let sequence: Array<{ paragraphIndex: number; value: number }> = [];

  const flush = () => {
    if (sequence.length >= 2) {
      sequence.forEach((candidate) => starts.add(candidate.paragraphIndex));
    }
  };

  for (const candidate of candidates) {
    const previous = sequence[sequence.length - 1];

    if (!previous || candidate.value === previous.value + 1) {
      sequence.push(candidate);
      continue;
    }

    flush();
    sequence = [candidate];
  }

  flush();
  return starts;
}

function standaloneRomanValue(text: string) {
  const trimmed = text.trim();

  if (!STANDALONE_ROMAN.test(trimmed)) {
    return null;
  }

  return romanToNumber(trimmed.replace(/[.)]/g, ""));
}

function romanToNumber(value: string) {
  const values: Record<string, number> = {
    i: 1,
    v: 5,
    x: 10,
    l: 50,
    c: 100,
    d: 500,
    m: 1000
  };
  const normalized = value.toLowerCase();
  let total = 0;
  let previous = 0;

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const current = values[normalized[index]];
    if (!current) {
      return null;
    }

    total += current < previous ? -current : current;
    previous = current;
  }

  return total > 0 ? total : null;
}

function listInfo(paragraph: Record<string, unknown>) {
  const numPr = record(record(paragraph.pPr).numPr);
  if (Object.keys(numPr).length === 0) {
    return undefined;
  }

  return {
    level: numberValue(record(numPr.ilvl).val),
    numId: stringValue(record(numPr.numId).val)
  };
}

function confidenceForDocxBlock(
  type: string,
  headingType: ImportHeadingType | undefined
) {
  if (type === "heading" && headingType && headingType !== "unknown") {
    return 0.96;
  }

  if (type === "heading") {
    return 0.78;
  }

  if (type === "title" || type === "list_item") {
    return 0.9;
  }

  return 0.86;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}
