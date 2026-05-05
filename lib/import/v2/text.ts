import { ManuscriptFormat } from "@prisma/client";
import { hashText } from "@/lib/compiler/hash";
import {
  createImportManifest,
  warning
} from "@/lib/import/v2/manifest";
import {
  TEXT_IMPORT_PARSER_VERSION,
  type ImportHeadingType,
  type ImportManifest,
  type ImportWarning,
  type ManuscriptIRBlock
} from "@/lib/import/v2/types";
import { countWords, normalizeWhitespace } from "@/lib/text/wordCount";

const CHAPTER_HEADING =
  /^(chapter|kapitel)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|ett|en|tv\u00e5|tva|tre|fyra|fem|sex|sju|\u00e5tta|atta|nio|tio)(?=$|[\s:.\-])[:.\-\s]*(.*)$/iu;
const SWEDISH_ORDINAL_CHAPTER =
  /^(f\u00f6rsta|forsta|andra|tredje|fj\u00e4rde|fjarde|femte|sj\u00e4tte|sjatte|sjunde|\u00e5ttonde|attonde|nionde|tionde)\s+kapitlet(?:\s*[:.\-]\s*(.*))?$/iu;
const STANDALONE_DIGITS = /^([0-9]{1,3})[.)]?$/;
const STANDALONE_ROMAN =
  /^(?=[ivxlcdm]{1,8}[.)]?$)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})[.)]?$/iu;
const NAMED_FRONT_BACK = /^(prologue|prolog|epilogue|epilog)$/iu;
const SCENE_BREAK = /^(\*{3,}|#{1,3}|-{3,}|~{3,}|\u00a7)$/u;
const EPUB_SECTION_HEADING = /^#{1,3}\s+(.+)$/u;
const FALLBACK_CHAPTER_WORDS = 6000;

type ParagraphBlock = {
  text: string;
  offset: number;
};

type HeadingDetection = {
  indexes: Map<number, HeadingDetectionValue>;
  starts: number[];
};

type HeadingDetectionValue = {
  confidence: number;
  headingType: ImportHeadingType;
  headingLevel?: number;
  method: string;
  warnings?: ImportWarning[];
};

export function buildTextImportManifest(input: {
  rawText: string;
  sourceFileName: string;
  sourceMimeType?: string;
  parserVersion?: string;
  fileHash?: string;
  warnings?: ImportWarning[];
}): ImportManifest {
  const normalized = normalizeWhitespace(input.rawText);
  const paragraphBlocks = splitParagraphBlocks(normalized);
  const detection = findHeadingStarts(paragraphBlocks);
  const titleIndex = detectTitleIndex(paragraphBlocks, detection.indexes);
  const blocks = paragraphBlocks.map((block, index) => {
    const detected = detection.indexes.get(index);
    const base = {
      id: `txt-${index + 1}`,
      order: index + 1,
      text: block.text,
      sourceAnchor: {
        sourceFileName: input.sourceFileName,
        sourceFormat: ManuscriptFormat.TXT,
        path: `text/paragraph[${index + 1}]`,
        paragraphIndex: index
      },
      offset: {
        blockIndex: index,
        paragraphIndex: index,
        characterStart: block.offset,
        characterEnd: block.offset + block.text.length
      },
      confidence: detected?.confidence ?? 0.82,
      warnings: detected?.warnings
    };

    if (index === titleIndex) {
      return {
        ...base,
        type: "title" as const,
        headingLevel: 0,
        headingType: "title" as const,
        confidence: 0.9
      };
    }

    if (detected) {
      return {
        ...base,
        type: "heading" as const,
        headingLevel: detected.headingLevel ?? 1,
        headingType: detected.headingType,
        metadata: { detectionMethod: detected.method }
      };
    }

    if (SCENE_BREAK.test(block.text.trim())) {
      return {
        ...base,
        type: "scene_break" as const,
        headingType: "scene" as const,
        confidence: 0.92
      };
    }

    return {
      ...base,
      type: "paragraph" as const
    };
  });

  const manifestWarnings = [
    ...(input.warnings ?? []),
    ...fallbackWarnings(detection, paragraphBlocks)
  ];

  return createImportManifest({
    parserVersion: input.parserVersion ?? TEXT_IMPORT_PARSER_VERSION,
    sourceFileName: input.sourceFileName,
    sourceMimeType: input.sourceMimeType,
    sourceFormat: ManuscriptFormat.TXT,
    fileHash: input.fileHash ?? hashText(normalized),
    blocks,
    warnings: manifestWarnings,
    metadata: {
      normalizedWith: "normalizeWhitespace",
      chapterDetection:
        "chapter/kapitel/numeric-sequence/roman-sequence/prologue/epilogue/epub-section/contextual-all-caps/fallback-length"
    }
  });
}

function splitParagraphBlocks(text: string): ParagraphBlock[] {
  const blocks: ParagraphBlock[] = [];
  const matches = text.matchAll(/(?:^|\n{2,})([\s\S]*?)(?=\n{2,}|$)/g);

  for (const match of matches) {
    const paragraph = match[1]?.trim();
    if (!paragraph) {
      continue;
    }

    blocks.push({
      text: normalizeParagraphBlockText(paragraph),
      offset: match.index ?? 0
    });
  }

  if (blocks.length === 0 && text.trim()) {
    blocks.push({ text: text.trim(), offset: 0 });
  }

  return blocks;
}

function normalizeParagraphBlockText(paragraph: string) {
  const trimmed = paragraph.trim();
  if (looksLikeVerseBlock(trimmed)) {
    return trimmed
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return trimmed.replace(/\n+/g, " ").trim();
}

function looksLikeVerseBlock(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3) {
    return false;
  }

  const wordCounts = lines.map((line) => countWords(line));
  const shortLines = wordCounts.filter((words) => words > 0 && words <= 8).length;
  const avgWords =
    wordCounts.reduce((sum, words) => sum + words, 0) /
    Math.max(1, wordCounts.length);

  return shortLines / lines.length >= 0.65 && avgWords <= 8;
}

function detectTitleIndex(
  blocks: ParagraphBlock[],
  headings: HeadingDetection["indexes"]
) {
  const firstHeading = Math.min(...headings.keys());

  return blocks.findIndex((block, index) => {
    if (headings.has(index)) {
      return false;
    }

    if (Number.isFinite(firstHeading) && index > firstHeading) {
      return false;
    }

    const words = countWords(block.text);
    return words > 0 && words <= 14 && block.text.length <= 120;
  });
}

function findHeadingStarts(blocks: ParagraphBlock[]): HeadingDetection {
  const indexes = new Map<number, HeadingDetectionValue>();
  const epubStarts = blocks
    .map((block, index) => (EPUB_SECTION_HEADING.test(block.text.trim()) ? index : -1))
    .filter((index) => index >= 0);

  if (epubStarts.length > 0) {
    for (const index of epubStarts) {
      indexes.set(index, {
        confidence: 0.93,
        headingType: "section",
        headingLevel: headingLevelFromMarkdown(blocks[index].text),
        method: "epub-section"
      });
    }

    return { starts: startsWithOpening(epubStarts), indexes };
  }

  const numericSequenceStarts = new Set(findSequentialStandaloneNumberStarts(blocks));

  blocks.forEach((block, index) => {
    const explicit = explicitHeading(block.text);
    if (explicit) {
      indexes.set(index, explicit);
      return;
    }

    if (numericSequenceStarts.has(index)) {
      indexes.set(index, {
        confidence: 0.78,
        headingType: "chapter",
        headingLevel: 1,
        method: "numeric-or-roman-sequence"
      });
    }
  });

  if (indexes.size >= 2) {
    blocks.forEach((block, index) => {
      if (!indexes.has(index) && looksLikeContextualAllCapsHeading(block.text)) {
        indexes.set(index, {
          confidence: 0.55,
          headingType: "section",
          headingLevel: 2,
          method: "contextual-all-caps",
          warnings: [
            warning({
              code: "low_confidence_all_caps_heading",
              message:
                "All-caps line was treated as a possible heading because nearby headings were already detected.",
              severity: "warning",
              confidence: 0.55
            })
          ]
        });
      }
    });
  }

  const starts = [...indexes.keys()].sort((a, b) => a - b);
  if (starts.length === 0) {
    return {
      starts: fallbackChapterStarts(blocks),
      indexes
    };
  }

  return { starts: startsWithOpening(starts), indexes };
}

function explicitHeading(text: string) {
  const trimmed = text.trim();
  const wordCount = countWords(trimmed);

  if (wordCount > 16 || trimmed.length > 120) {
    return null;
  }

  if (CHAPTER_HEADING.test(trimmed) || SWEDISH_ORDINAL_CHAPTER.test(trimmed)) {
    return {
      confidence: 0.94,
      headingType: "chapter" as const,
      headingLevel: 1,
      method: "explicit-chapter"
    };
  }

  if (NAMED_FRONT_BACK.test(trimmed)) {
    return {
      confidence: 0.94,
      headingType: "front_matter" as const,
      headingLevel: 1,
      method: "front-back-matter"
    };
  }

  if (EPUB_SECTION_HEADING.test(trimmed)) {
    return {
      confidence: 0.9,
      headingType: "section" as const,
      headingLevel: headingLevelFromMarkdown(trimmed),
      method: "marked-section"
    };
  }

  return null;
}

function looksLikeContextualAllCapsHeading(text: string) {
  const trimmed = text.trim();
  const wordCount = countWords(trimmed);

  if (
    trimmed.includes("\n") ||
    wordCount === 0 ||
    wordCount > 10 ||
    /[.!?,;:\u2026-]$/.test(trimmed)
  ) {
    return false;
  }

  const letters = trimmed.replace(/[^\p{L}]/gu, "");
  if (letters.length < 4) {
    return false;
  }

  const uppercaseLetters = letters.replace(/[^\p{Lu}]/gu, "").length;
  return uppercaseLetters / letters.length > 0.7;
}

function findSequentialStandaloneNumberStarts(blocks: ParagraphBlock[]) {
  const candidates = blocks
    .map((block, index) => {
      const value = standaloneNumberValue(block.text);
      return value === null ? null : { index, value };
    })
    .filter((candidate): candidate is { index: number; value: number } =>
      Boolean(candidate)
    );
  const starts = new Set<number>();
  let sequence: Array<{ index: number; value: number }> = [];

  const flush = () => {
    if (sequence.length >= 2) {
      sequence.forEach((candidate) => starts.add(candidate.index));
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
  return [...starts].sort((a, b) => a - b);
}

function standaloneNumberValue(text: string) {
  const trimmed = text.trim();
  const digitMatch = trimmed.match(STANDALONE_DIGITS);
  if (digitMatch) {
    return Number(digitMatch[1]);
  }

  if (STANDALONE_ROMAN.test(trimmed)) {
    return romanToNumber(trimmed.replace(/[.)]/g, ""));
  }

  return null;
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

function fallbackChapterStarts(blocks: ParagraphBlock[]) {
  if (blocks.length === 0) {
    return [0];
  }

  const starts = [0];
  let pendingWords = 0;

  blocks.forEach((block, index) => {
    pendingWords += countWords(block.text);
    if (index > 0 && pendingWords >= FALLBACK_CHAPTER_WORDS) {
      starts.push(index + 1);
      pendingWords = 0;
    }
  });

  return starts.filter((start) => start < blocks.length);
}

function startsWithOpening(starts: number[]) {
  const sorted = [...starts].sort((a, b) => a - b);
  return sorted[0] > 0 ? [0, ...sorted] : sorted;
}

function headingLevelFromMarkdown(text: string) {
  const match = text.match(/^(#{1,6})\s+/);
  return match ? match[1].length : 1;
}

function fallbackWarnings(
  detection: HeadingDetection,
  blocks: ParagraphBlock[]
): ImportWarning[] {
  if (detection.indexes.size > 0) {
    return [];
  }

  return [
    warning({
      code: "fallback_length_chaptering",
      message:
        blocks.length > 0
          ? "No explicit headings were detected; import used length-based fallback structure."
          : "No text blocks were detected in the source.",
      severity: blocks.length > 0 ? "warning" : "critical",
      confidence: blocks.length > 0 ? 0.35 : 0
    })
  ];
}
