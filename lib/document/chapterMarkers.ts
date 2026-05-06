import type { DocumentPage } from "@/lib/document/pageMarkers";
import { countWords } from "@/lib/text/wordCount";

export type DocumentChapterDetectionMethod =
  | "explicit_heading"
  | "marked_heading"
  | "numeric_sequence"
  | "page_top_heading";

export type DocumentChapter = {
  order: number;
  title: string;
  heading: string;
  text: string;
  startPageNumber: number;
  endPageNumber: number;
  wordCount: number;
  preview: string;
  confidence: number;
  method: DocumentChapterDetectionMethod;
};

export type DocumentChapterDetectionWarning = {
  code: "chapters_not_detected";
  title: string;
  message: string;
  instructions: string[];
};

export type DocumentChapterDetection = {
  canDetermineChapters: boolean;
  chapters: DocumentChapter[];
  methods: DocumentChapterDetectionMethod[];
  warning: DocumentChapterDetectionWarning | null;
};

type LineRef = {
  text: string;
  trimmed: string;
  pageIndex: number;
  pageNumber: number;
  lineIndex: number;
  globalLineIndex: number;
};

type ChapterStartCandidate = {
  line: LineRef;
  title: string;
  confidence: number;
  method: DocumentChapterDetectionMethod;
  priority: number;
};

type StandaloneNumberCandidate = {
  value: number;
  kind: "digit" | "roman";
};

const CHAPTER_HEADING =
  /^(chapter|kapitel)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|ett|en|tv\u00e5|tva|tre|fyra|fem|sex|sju|\u00e5tta|atta|nio|tio)(?=$|[\s:.\-])[:.\-\s]*(.*)$/iu;
const SWEDISH_ORDINAL_CHAPTER =
  /^(f\u00f6rsta|forsta|andra|tredje|fj\u00e4rde|fjarde|femte|sj\u00e4tte|sjatte|sjunde|\u00e5ttonde|attonde|nionde|tionde)\s+kapitlet(?:\s*[:.\-]\s*(.*))?$/iu;
const STANDALONE_DIGITS = /^([0-9]{1,3})[.)]?$/u;
const STANDALONE_ROMAN =
  /^(?=[ivxlcdm]{1,8}[.)]?$)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})[.)]?$/iu;
const MARKED_HEADING = /^#{1,3}\s+(.+)$/u;
const NAMED_FRONT_BACK = /^(prologue|prolog|epilogue|epilog)$/iu;
const CHAPTER_GUIDANCE = [
  "Skriv kapitelrubriker som egen rad, till exempel: Kapitel 1, Kapitel 2, Kapitel 3.",
  "Eller använd en ren nummerserie som egen rad före varje kapitel: 1, 2, 3.",
  "I Word: använd Rubrik 1/Heading 1, eller placera en kort kapitelrubrik först på en ny sida med blankrad före brödtexten."
];

export function detectDocumentChapters(
  pages: DocumentPage[]
): DocumentChapterDetection {
  const lines = flattenPages(pages);
  const { candidates, pageTopCandidates } = findChapterStartCandidates(
    pages,
    lines
  );

  const canDetermineChapters =
    candidates.some((candidate) => candidate.method !== "page_top_heading") ||
    pageTopCandidates.length >= 2;

  if (!canDetermineChapters || candidates.length === 0) {
    return {
      canDetermineChapters: false,
      chapters: [],
      methods: [],
      warning: chapterDetectionWarning()
    };
  }

  const chapters = buildDetectedChapters(pages, lines, candidates);

  return {
    canDetermineChapters: chapters.length > 0,
    chapters,
    methods: [...new Set(chapters.map((chapter) => chapter.method))],
    warning: chapters.length > 0 ? null : chapterDetectionWarning()
  };
}

export function updateDocumentChapterText(
  pages: DocumentPage[],
  chapterOrder: number,
  nextText: string
): DocumentPage[] {
  const lines = flattenPages(pages);
  const { candidates } = findChapterStartCandidates(pages, lines);
  const target = candidates[chapterOrder - 1];

  if (!target) {
    return pages;
  }

  const nextCandidate = candidates[chapterOrder];
  const rangeLines = lines.filter(
    (line) =>
      line.globalLineIndex >= target.line.globalLineIndex &&
      (!nextCandidate || line.globalLineIndex < nextCandidate.line.globalLineIndex)
  );

  if (rangeLines.length === 0) {
    return pages;
  }

  const replacementLines = normalizeLineEndings(nextText).split("\n");
  const linesByPage = pages.map((page) => normalizeLineEndings(page.text).split("\n"));
  const rangeByPage = new Map<number, LineRef[]>();

  for (const line of rangeLines) {
    const pageLines = rangeByPage.get(line.pageIndex) ?? [];
    pageLines.push(line);
    rangeByPage.set(line.pageIndex, pageLines);
  }

  const affectedPageIndexes = [...rangeByPage.keys()].sort((a, b) => a - b);
  let replacementOffset = 0;

  affectedPageIndexes.forEach((pageIndex, index) => {
    const pageRangeLines = rangeByPage.get(pageIndex) ?? [];
    if (pageRangeLines.length === 0) {
      return;
    }

    const firstLineIndex = pageRangeLines[0].lineIndex;
    const removeCount = pageRangeLines.length;
    const isLastPage = index === affectedPageIndexes.length - 1;
    const insertCount = isLastPage
      ? replacementLines.length - replacementOffset
      : Math.min(
          pageRangeLines.length,
          Math.max(0, replacementLines.length - replacementOffset)
        );
    const insertLines = replacementLines.slice(
      replacementOffset,
      replacementOffset + insertCount
    );

    replacementOffset += insertCount;
    linesByPage[pageIndex].splice(firstLineIndex, removeCount, ...insertLines);
  });

  return pages.map((page, index) => ({
    ...page,
    text: linesByPage[index].join("\n")
  }));
}

function findChapterStartCandidates(pages: DocumentPage[], lines: LineRef[]) {
  const explicitCandidates = findExplicitHeadingCandidates(lines);
  const numericCandidates = findSequentialNumericCandidates(lines);
  const pageTopCandidates = findPageTopHeadingCandidates(pages, lines);
  const candidates =
    explicitCandidates.length > 0 || numericCandidates.length > 0
      ? mergeCandidates([...explicitCandidates, ...numericCandidates])
      : mergeCandidates(pageTopCandidates);

  return { candidates, pageTopCandidates };
}

function findExplicitHeadingCandidates(lines: LineRef[]) {
  const candidates: ChapterStartCandidate[] = [];

  for (const line of lines) {
    if (!line.trimmed) {
      continue;
    }

    const explicit = explicitHeadingTitle(line.trimmed);
    if (explicit) {
      candidates.push({
        line,
        title: explicit,
        confidence: 0.94,
        method: "explicit_heading",
        priority: 4
      });
      continue;
    }

    const marked = markedHeadingTitle(line.trimmed);
    if (marked && lineIsHeadingPosition(lines, line)) {
      candidates.push({
        line,
        title: marked,
        confidence: 0.88,
        method: "marked_heading",
        priority: 3
      });
    }
  }

  return candidates;
}

function findSequentialNumericCandidates(lines: LineRef[]) {
  const numericLines = lines
    .map((line) => {
      const candidate = standaloneNumberCandidate(line.trimmed);
      return candidate === null || !lineIsHeadingPosition(lines, line)
        ? null
        : { line, ...candidate };
    })
    .filter(
      (
        candidate
      ): candidate is {
        line: LineRef;
        value: number;
        kind: StandaloneNumberCandidate["kind"];
      } =>
        Boolean(candidate)
    );
  const starts = new Set<LineRef>();

  for (const kind of ["digit", "roman"] as const) {
    collectSequentialNumberStarts(
      numericLines.filter((candidate) => candidate.kind === kind)
    ).forEach((line) => starts.add(line));
  }

  return [...starts]
    .sort((a, b) => a.globalLineIndex - b.globalLineIndex)
    .map(
      (line): ChapterStartCandidate => ({
        line,
        title: line.trimmed.replace(/[.)]$/u, ""),
        confidence: 0.82,
        method: "numeric_sequence",
        priority: 2
      })
    );
}

function findPageTopHeadingCandidates(
  pages: DocumentPage[],
  lines: LineRef[]
): ChapterStartCandidate[] {
  const byPage = new Map<number, LineRef[]>();
  for (const line of lines) {
    const pageLines = byPage.get(line.pageIndex) ?? [];
    pageLines.push(line);
    byPage.set(line.pageIndex, pageLines);
  }

  const candidates: ChapterStartCandidate[] = [];

  pages.forEach((_, pageIndex) => {
    const pageLines = byPage.get(pageIndex) ?? [];
    const firstContentLine = pageLines.find((line) => line.trimmed);
    if (!firstContentLine || !looksLikePageTopHeading(pageLines, firstContentLine)) {
      return;
    }

    candidates.push({
      line: firstContentLine,
      title: cleanHeadingTitle(firstContentLine.trimmed),
      confidence: 0.64,
      method: "page_top_heading",
      priority: 1
    });
  });

  return candidates;
}

function buildDetectedChapters(
  pages: DocumentPage[],
  lines: LineRef[],
  candidates: ChapterStartCandidate[]
) {
  return candidates.map((candidate, index) => {
    const nextCandidate = candidates[index + 1];
    const rangeLines = lines.filter(
      (line) =>
        line.globalLineIndex >= candidate.line.globalLineIndex &&
        (!nextCandidate ||
          line.globalLineIndex < nextCandidate.line.globalLineIndex)
    );
    const bodyLines = rangeLines.slice(1);
    const chapterText = bodyLines.map((line) => line.text).join("\n").trim();
    const lastContentLine =
      [...rangeLines].reverse().find((line) => line.trimmed) ?? candidate.line;

    return {
      order: index + 1,
      title: candidate.title,
      heading: candidate.line.trimmed,
      text: rangeLines.map((line) => line.text).join("\n"),
      startPageNumber: candidate.line.pageNumber,
      endPageNumber: lastContentLine.pageNumber,
      wordCount: countWords(chapterText),
      preview: chapterPreview(bodyLines),
      confidence: candidate.confidence,
      method: candidate.method
    } satisfies DocumentChapter;
  });
}

function flattenPages(pages: DocumentPage[]) {
  const lines: LineRef[] = [];
  let globalLineIndex = 0;

  pages.forEach((page, pageIndex) => {
    const pageLines = normalizeLineEndings(page.text).split("\n");

    pageLines.forEach((line, lineIndex) => {
      lines.push({
        text: line,
        trimmed: line.trim(),
        pageIndex,
        pageNumber: page.pageNumber,
        lineIndex,
        globalLineIndex
      });
      globalLineIndex += 1;
    });
  });

  return lines;
}

function explicitHeadingTitle(text: string) {
  if (!isShortHeadingText(text)) {
    return null;
  }

  if (
    CHAPTER_HEADING.test(text) ||
    SWEDISH_ORDINAL_CHAPTER.test(text) ||
    NAMED_FRONT_BACK.test(text)
  ) {
    return cleanHeadingTitle(text);
  }

  return null;
}

function markedHeadingTitle(text: string) {
  const match = text.match(MARKED_HEADING);
  if (!match) {
    return null;
  }

  const title = cleanHeadingTitle(match[1] ?? "");
  return isShortHeadingText(title) ? title : null;
}

function lineIsHeadingPosition(lines: LineRef[], line: LineRef) {
  const previous = previousLine(lines, line);
  const next = nextNonEmptyLine(lines, line);

  if (!next) {
    return false;
  }

  return !previous || previous.trimmed.length === 0 || isFirstContentLine(lines, line);
}

function looksLikePageTopHeading(pageLines: LineRef[], line: LineRef) {
  if (!isShortHeadingText(line.trimmed)) {
    return false;
  }

  if (/[.!?;]$/u.test(line.trimmed)) {
    return false;
  }

  if (/^[-*•]/u.test(line.trimmed) || /^["'”]/u.test(line.trimmed)) {
    return false;
  }

  const afterHeading = pageLines
    .filter((candidate) => candidate.lineIndex > line.lineIndex)
    .map((candidate) => candidate.text)
    .join("\n");

  return countWords(afterHeading) >= 8;
}

function isShortHeadingText(text: string) {
  const words = countWords(text);
  return words > 0 && words <= 14 && text.length <= 120 && !text.includes("\t");
}

function standaloneNumberCandidate(
  text: string
): StandaloneNumberCandidate | null {
  const digitMatch = text.match(STANDALONE_DIGITS);
  if (digitMatch) {
    return { value: Number(digitMatch[1]), kind: "digit" };
  }

  if (STANDALONE_ROMAN.test(text)) {
    const value = romanToNumber(text.replace(/[.)]/g, ""));
    return value === null ? null : { value, kind: "roman" };
  }

  return null;
}

function collectSequentialNumberStarts(
  candidates: Array<{
    line: LineRef;
    value: number;
    kind: StandaloneNumberCandidate["kind"];
  }>
) {
  const starts = new Set<LineRef>();
  let sequence: Array<{ line: LineRef; value: number }> = [];

  const flush = () => {
    if (sequence.length >= 2) {
      sequence.forEach((candidate) => starts.add(candidate.line));
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
  return [...starts];
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

function mergeCandidates(candidates: ChapterStartCandidate[]) {
  const byLine = new Map<string, ChapterStartCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.line.pageIndex}:${candidate.line.lineIndex}`;
    const current = byLine.get(key);

    if (!current || candidate.priority > current.priority) {
      byLine.set(key, candidate);
    }
  }

  return [...byLine.values()].sort(
    (a, b) => a.line.globalLineIndex - b.line.globalLineIndex
  );
}

function chapterPreview(lines: LineRef[]) {
  return lines
    .map((line) => line.trimmed)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

function cleanHeadingTitle(text: string) {
  return text.replace(/^#{1,6}\s+/u, "").trim();
}

function previousLine(lines: LineRef[], line: LineRef) {
  return lines[line.globalLineIndex - 1];
}

function nextNonEmptyLine(lines: LineRef[], line: LineRef) {
  return lines.find(
    (candidate) =>
      candidate.globalLineIndex > line.globalLineIndex && candidate.trimmed
  );
}

function isFirstContentLine(lines: LineRef[], line: LineRef) {
  return !lines.some(
    (candidate) =>
      candidate.pageIndex === line.pageIndex &&
      candidate.lineIndex < line.lineIndex &&
      candidate.trimmed
  );
}

function normalizeLineEndings(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function chapterDetectionWarning(): DocumentChapterDetectionWarning {
  return {
    code: "chapters_not_detected",
    title: "Kapitel kunde inte fastställas",
    message:
      "Dokumentet saknar tillräckligt tydliga kapitelmarkörer för att visa en säker kapitelvy.",
    instructions: CHAPTER_GUIDANCE
  };
}
