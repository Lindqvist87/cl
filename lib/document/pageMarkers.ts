import type { ImportManifest, ManuscriptIRBlock } from "@/lib/import/v2/types";
import type { JsonRecord } from "@/lib/types";

export type DocumentPage = {
  pageNumber: number;
  text: string;
};

export type DocumentPaginationLayout = {
  pageWidthTwips?: number;
  pageHeightTwips?: number;
  marginTopTwips?: number;
  marginRightTwips?: number;
  marginBottomTwips?: number;
  marginLeftTwips?: number;
  defaultFontSizeHalfPoints?: number;
  lineHeightTwips?: number;
  paragraphBeforeTwips?: number;
  paragraphAfterTwips?: number;
};

const PAGE_MARKER_PATTERN = /^\[\[Sida\s+([0-9]+)\]\]$/iu;
const TWIPS_PER_POINT = 20;
const DEFAULT_PAGINATION_LAYOUT: Required<DocumentPaginationLayout> = {
  pageWidthTwips: 12240,
  pageHeightTwips: 15840,
  marginTopTwips: 1440,
  marginRightTwips: 1440,
  marginBottomTwips: 1440,
  marginLeftTwips: 1440,
  defaultFontSizeHalfPoints: 22,
  lineHeightTwips: 276,
  paragraphBeforeTwips: 0,
  paragraphAfterTwips: 160
};

export function documentPageMarker(pageNumber: number) {
  return `[[Sida ${Math.max(1, Math.floor(pageNumber))}]]`;
}

export function splitDocumentIntoPages(text: string | null | undefined): DocumentPage[] {
  const normalized = normalizeLineEndings(text ?? "");
  const lines = normalized.split("\n");
  const pages: DocumentPage[] = [];
  let currentPageNumber = 1;
  let currentLines: string[] = [];
  let sawMarker = false;

  for (const line of lines) {
    const match = line.trim().match(PAGE_MARKER_PATTERN);

    if (!match) {
      currentLines.push(line);
      continue;
    }

    if (sawMarker || currentLines.some((item) => item.trim())) {
      pages.push({
        pageNumber: currentPageNumber,
        text: trimPageText(currentLines.join("\n"))
      });
    }

    sawMarker = true;
    currentPageNumber = Number(match[1]);
    currentLines = [];
  }

  pages.push({
    pageNumber: currentPageNumber,
    text: trimPageText(currentLines.join("\n"))
  });

  return normalizePageNumbers(
    pages.filter((page, index) => index === 0 || page.text.trim() || sawMarker)
  );
}

export function joinDocumentPages(pages: DocumentPage[]) {
  const normalizedPages = normalizePageNumbers(pages);

  return normalizedPages
    .map((page) =>
      [documentPageMarker(page.pageNumber), trimPageText(page.text)]
        .filter((part) => part.length > 0)
        .join("\n\n")
    )
    .join("\n\n")
    .trim();
}

export function stripDocumentPageMarkers(text: string | null | undefined) {
  return normalizeLineEndings(text ?? "")
    .split("\n")
    .filter((line) => !PAGE_MARKER_PATTERN.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function importManifestToPagedDocumentText(
  input: Pick<ImportManifest, "blocks" | "metadata">
) {
  if (!hasExplicitPageBreaks(input.blocks)) {
    return joinDocumentPages(estimateDocumentPages(input));
  }

  const pages: DocumentPage[] = [];
  let currentLines: string[] = [];
  let pageNumber = 1;
  let pageHasContent = false;

  const flushPage = () => {
    pages.push({
      pageNumber,
      text: trimPageText(currentLines.join("\n\n"))
    });
    currentLines = [];
    pageHasContent = false;
  };

  for (const block of input.blocks) {
    if (shouldSkipBlock(block)) {
      continue;
    }

    if (block.type === "page_break") {
      flushPage();
      pageNumber += 1;
      continue;
    }

    const text = block.text.trim();
    if (!text) {
      continue;
    }

    if (block.pageBreakBefore && pageHasContent) {
      flushPage();
      pageNumber += 1;
    }

    currentLines.push(text);
    pageHasContent = true;
  }

  flushPage();
  return joinDocumentPages(pages);
}

function estimateDocumentPages(
  input: Pick<ImportManifest, "blocks" | "metadata">
): DocumentPage[] {
  const metrics = createPaginationMetrics(readPaginationLayout(input.metadata));
  const pages: DocumentPage[] = [];
  let currentLines: string[] = [];
  let remainingLines = metrics.linesPerPage;

  const flushPage = () => {
    pages.push({
      pageNumber: pages.length + 1,
      text: trimPageText(currentLines.join("\n\n"))
    });
    currentLines = [];
    remainingLines = metrics.linesPerPage;
  };

  for (const block of input.blocks) {
    if (shouldSkipBlock(block) || block.type === "page_break") {
      continue;
    }

    const text = block.text.trim();
    if (!text) {
      continue;
    }

    for (const chunk of splitBlockIntoEstimatedPageChunks(text, block, metrics)) {
      if (chunk.estimatedLines > remainingLines && currentLines.length > 0) {
        flushPage();
      }

      currentLines.push(chunk.text);
      remainingLines -= Math.min(chunk.estimatedLines, metrics.linesPerPage);

      if (remainingLines <= 0) {
        flushPage();
      }
    }
  }

  if (currentLines.length > 0 || pages.length === 0) {
    flushPage();
  }

  return pages;
}

function hasExplicitPageBreaks(blocks: ManuscriptIRBlock[]) {
  return blocks.some(
    (block) =>
      !shouldSkipBlock(block) &&
      (block.type === "page_break" || block.pageBreakBefore === true)
  );
}

function splitBlockIntoEstimatedPageChunks(
  text: string,
  block: ManuscriptIRBlock,
  metrics: PaginationMetrics
): Array<{ text: string; estimatedLines: number }> {
  const estimatedLines = estimateBlockLines(text, block, metrics);

  if (estimatedLines <= metrics.linesPerPage) {
    return [{ text, estimatedLines }];
  }

  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length <= 1) {
    return splitLongUnbrokenText(text, block, metrics);
  }

  const wordsPerLine = Math.max(4, Math.floor(metrics.charsPerLine / 6));
  const wordsPerPage = Math.max(
    wordsPerLine,
    Math.floor(metrics.linesPerPage * wordsPerLine * 0.9)
  );
  const chunks: Array<{ text: string; estimatedLines: number }> = [];

  for (let index = 0; index < words.length; index += wordsPerPage) {
    const chunkText = words.slice(index, index + wordsPerPage).join(" ");
    chunks.push({
      text: chunkText,
      estimatedLines: estimateBlockLines(chunkText, block, metrics)
    });
  }

  return chunks;
}

function splitLongUnbrokenText(
  text: string,
  block: ManuscriptIRBlock,
  metrics: PaginationMetrics
) {
  const charactersPerPage = Math.max(
    metrics.charsPerLine,
    Math.floor(metrics.charsPerLine * metrics.linesPerPage * 0.9)
  );
  const chunks: Array<{ text: string; estimatedLines: number }> = [];

  for (let index = 0; index < text.length; index += charactersPerPage) {
    const chunkText = text.slice(index, index + charactersPerPage);
    chunks.push({
      text: chunkText,
      estimatedLines: estimateBlockLines(chunkText, block, metrics)
    });
  }

  return chunks;
}

function estimateBlockLines(
  text: string,
  block: ManuscriptIRBlock,
  metrics: PaginationMetrics
) {
  const wrappedLines = normalizeLineEndings(text)
    .split("\n")
    .reduce(
      (lineCount, line) =>
        lineCount + Math.max(1, Math.ceil(line.length / metrics.charsPerLine)),
      0
    );
  const spacing = readBlockSpacing(block.metadata);

  return (
    wrappedLines +
    (spacing.beforeTwips + spacing.afterTwips) / metrics.lineHeightTwips
  );
}

type PaginationMetrics = {
  charsPerLine: number;
  linesPerPage: number;
  lineHeightTwips: number;
  paragraphBeforeTwips: number;
  paragraphAfterTwips: number;
};

function createPaginationMetrics(layout: Required<DocumentPaginationLayout>) {
  const usableWidthTwips = Math.max(
    1440,
    layout.pageWidthTwips - layout.marginLeftTwips - layout.marginRightTwips
  );
  const usableHeightTwips = Math.max(
    1440,
    layout.pageHeightTwips - layout.marginTopTwips - layout.marginBottomTwips
  );
  const fontSizePoints = Math.max(8, layout.defaultFontSizeHalfPoints / 2);
  const averageCharacterWidthTwips = Math.max(
    80,
    fontSizePoints * TWIPS_PER_POINT * 0.52
  );

  return {
    charsPerLine: clamp(
      Math.floor(usableWidthTwips / averageCharacterWidthTwips),
      28,
      110
    ),
    linesPerPage: clamp(
      Math.floor(usableHeightTwips / layout.lineHeightTwips),
      12,
      90
    ),
    lineHeightTwips: layout.lineHeightTwips,
    paragraphBeforeTwips: layout.paragraphBeforeTwips,
    paragraphAfterTwips: layout.paragraphAfterTwips
  };
}

function readPaginationLayout(metadata: JsonRecord | undefined) {
  const candidate = record(record(metadata).pageLayout);

  return {
    pageWidthTwips:
      numberValue(candidate.pageWidthTwips) ??
      DEFAULT_PAGINATION_LAYOUT.pageWidthTwips,
    pageHeightTwips:
      numberValue(candidate.pageHeightTwips) ??
      DEFAULT_PAGINATION_LAYOUT.pageHeightTwips,
    marginTopTwips:
      numberValue(candidate.marginTopTwips) ??
      DEFAULT_PAGINATION_LAYOUT.marginTopTwips,
    marginRightTwips:
      numberValue(candidate.marginRightTwips) ??
      DEFAULT_PAGINATION_LAYOUT.marginRightTwips,
    marginBottomTwips:
      numberValue(candidate.marginBottomTwips) ??
      DEFAULT_PAGINATION_LAYOUT.marginBottomTwips,
    marginLeftTwips:
      numberValue(candidate.marginLeftTwips) ??
      DEFAULT_PAGINATION_LAYOUT.marginLeftTwips,
    defaultFontSizeHalfPoints:
      numberValue(candidate.defaultFontSizeHalfPoints) ??
      DEFAULT_PAGINATION_LAYOUT.defaultFontSizeHalfPoints,
    lineHeightTwips:
      numberValue(candidate.lineHeightTwips) ??
      DEFAULT_PAGINATION_LAYOUT.lineHeightTwips,
    paragraphBeforeTwips:
      numberValue(candidate.paragraphBeforeTwips) ??
      DEFAULT_PAGINATION_LAYOUT.paragraphBeforeTwips,
    paragraphAfterTwips:
      numberValue(candidate.paragraphAfterTwips) ??
      DEFAULT_PAGINATION_LAYOUT.paragraphAfterTwips
  };
}

function readBlockSpacing(metadata: JsonRecord | undefined) {
  const spacing = record(record(metadata).docxSpacing);

  return {
    beforeTwips:
      numberValue(spacing.beforeTwips) ??
      DEFAULT_PAGINATION_LAYOUT.paragraphBeforeTwips,
    afterTwips:
      numberValue(spacing.afterTwips) ??
      DEFAULT_PAGINATION_LAYOUT.paragraphAfterTwips
  };
}

function shouldSkipBlock(block: ManuscriptIRBlock) {
  return block.type === "comment" || block.type === "track_change";
}

function normalizePageNumbers(pages: DocumentPage[]) {
  if (pages.length === 0) {
    return [{ pageNumber: 1, text: "" }];
  }

  return pages.map((page, index) => ({
    pageNumber: index + 1,
    text: trimPageText(page.text)
  }));
}

function normalizeLineEndings(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function trimPageText(text: string) {
  return normalizeLineEndings(text).replace(/[ \t]+\n/g, "\n").trim();
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
