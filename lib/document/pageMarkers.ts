import type { ImportManifest, ManuscriptIRBlock } from "@/lib/import/v2/types";

export type DocumentPage = {
  pageNumber: number;
  text: string;
};

const PAGE_MARKER_PATTERN = /^\[\[Sida\s+([0-9]+)\]\]$/iu;

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
  input: Pick<ImportManifest, "blocks">
) {
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
