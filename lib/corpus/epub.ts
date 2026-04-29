import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import {
  HTMLElement,
  NodeType,
  parse,
  type Node as HtmlNode
} from "node-html-parser";
import { countWords, normalizeWhitespace } from "@/lib/text/wordCount";

export type EpubExtractedChapter = {
  order: number;
  title: string;
  href: string;
  manifestId: string;
  text: string;
  wordCount: number;
};

export type EpubExtractionReport = {
  format: "EPUB";
  sourceFormat: "EPUB";
  fileName?: string;
  rootfilePath: string;
  spineItemCount: number;
  extractedDocumentCount: number;
  skippedDocumentCount: number;
  skippedDocuments: Array<{
    href: string;
    reason: string;
  }>;
  detectedTitle?: string;
  detectedAuthor?: string;
  detectedLanguage?: string;
  detectedPublisher?: string;
  detectedPublicationDate?: string;
  detectedIdentifier?: string;
  warnings: string[];
  tocRemoved: boolean;
  tocRemovedCount: number;
  navRemoved: boolean;
  navRemovedCount: number;
  poetryFormattingPreserved: boolean;
  titleCardMergedCount: number;
  chapters: Array<{
    order: number;
    title: string;
    href: string;
    wordCount: number;
  }>;
};

export type EpubExtractionResult = {
  sourceFormat: "EPUB";
  rawText: string;
  cleanedText: string;
  chapters: EpubExtractedChapter[];
  extractionWarnings: string[];
  detectedTitle?: string;
  detectedAuthor?: string;
  detectedLanguage?: string;
  detectedPublisher?: string;
  detectedPublicationDate?: string;
  detectedIdentifier?: string;
  extractionReport: EpubExtractionReport;
};

type ManifestItem = {
  id: string;
  href: string;
  mediaType?: string;
  properties?: string;
};

type SpineItem = {
  idref: string;
  linear?: string;
};

type ZipIndex = Map<string, JSZip.JSZipObject>;

type HtmlExtraction = {
  title?: string;
  blocks: string[];
  looksLikeToc: boolean;
  navRemovedCount: number;
  tocRemovedCount: number;
  poetryFormattingPreserved: boolean;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false
});

const HTML_MEDIA_TYPES = new Set([
  "application/xhtml+xml",
  "text/html",
  "application/html",
  "application/xml",
  "text/xml"
]);

const HEADING_TAGS = new Set(["h1", "h2", "h3"]);
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "caption",
  "dd",
  "div",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul"
]);
const TEXT_BLOCK_TAGS = new Set([
  "blockquote",
  "caption",
  "dd",
  "dt",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "p",
  "pre",
  "td",
  "th"
]);
const REMOVED_TAGS = new Set(["script", "style", "nav"]);
const NAV_WORDS = /\b(contents?|table[-_\s]?of[-_\s]?contents|toc|nav(?:igation)?|page[-_\s]?list|landmarks?)\b/i;
const VERSE_WORDS = /\b(poem|poetry|verse|verses|stanza|linegroup|line-group|line)\b/i;

export async function extractTextFromEpub(file: File): Promise<EpubExtractionResult> {
  return extractTextFromEpubBuffer(Buffer.from(await file.arrayBuffer()), file.name);
}

export async function extractTextFromEpubBuffer(
  input: Buffer | Uint8Array | ArrayBuffer,
  fileName?: string
): Promise<EpubExtractionResult> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(input);
  const zipIndex = indexZip(zip);
  const containerPath = findZipPath(zipIndex, "META-INF/container.xml");

  if (!containerPath) {
    throw new Error("EPUB container.xml was not found at META-INF/container.xml.");
  }

  const containerXml = await readZipText(zipIndex, containerPath);
  const container = xmlParser.parse(containerXml);
  const rootfiles = asArray(
    container?.container?.rootfiles?.rootfile
  );
  const firstRootfile = objectValue(rootfiles[0]);
  const rootfilePath = normalizeZipPath(
    stringValue(firstRootfile["full-path"]) ?? ""
  );

  if (!rootfilePath) {
    throw new Error("EPUB container.xml did not declare an OPF rootfile.");
  }

  const opfPath = findZipPath(zipIndex, rootfilePath);
  if (!opfPath) {
    throw new Error(`EPUB OPF package file was not found: ${rootfilePath}`);
  }

  const opfXml = await readZipText(zipIndex, opfPath);
  const opf = xmlParser.parse(opfXml);
  const pkg = opf?.package;

  if (!pkg) {
    throw new Error(`EPUB OPF package could not be parsed: ${rootfilePath}`);
  }

  const opfDir = dirname(opfPath);
  const metadata = extractOpfMetadata(pkg.metadata);
  const manifestItems = extractManifestItems(pkg.manifest);
  const manifestById = new Map(manifestItems.map((item) => [item.id, item]));
  const spineItems = extractSpineItems(pkg.spine);

  if (spineItems.length === 0) {
    throw new Error("EPUB OPF package did not contain a readable spine.");
  }

  let navRemovedCount = 0;
  let tocRemovedCount = 0;
  let poetryFormattingPreserved = false;
  const skippedDocuments: EpubExtractionReport["skippedDocuments"] = [];
  const chapters: EpubExtractedChapter[] = [];

  for (const spineItem of spineItems) {
    const manifestItem = manifestById.get(spineItem.idref);
    if (!manifestItem) {
      warnings.push(`Spine item ${spineItem.idref} was not present in the manifest.`);
      skippedDocuments.push({
        href: spineItem.idref,
        reason: "missing manifest item"
      });
      continue;
    }

    if (spineItem.linear?.toLowerCase() === "no") {
      skippedDocuments.push({
        href: manifestItem.href,
        reason: "non-linear spine item"
      });
      continue;
    }

    if (!isHtmlManifestItem(manifestItem)) {
      skippedDocuments.push({
        href: manifestItem.href,
        reason: `unsupported media type ${manifestItem.mediaType ?? "unknown"}`
      });
      continue;
    }

    const href = resolveZipPath(opfDir, manifestItem.href);
    const zipPath = findZipPath(zipIndex, href);
    if (!zipPath) {
      warnings.push(`Spine document was listed but not found in the archive: ${href}`);
      skippedDocuments.push({
        href,
        reason: "missing spine document"
      });
      continue;
    }

    if (spineItems.length > 1 && isNavigationManifestItem(manifestItem, zipPath)) {
      tocRemovedCount += isTocLikePath(zipPath) ? 1 : 0;
      navRemovedCount += manifestItem.properties?.includes("nav") ? 1 : 0;
      skippedDocuments.push({
        href: zipPath,
        reason: "navigation or table of contents document"
      });
      continue;
    }

    if (spineItems.length > 1 && isSourceBoilerplatePath(zipPath)) {
      skippedDocuments.push({
        href: zipPath,
        reason: "source colophon or boilerplate document"
      });
      continue;
    }

    const html = await readZipText(zipIndex, zipPath);
    const extracted = extractHtmlDocument(html);
    navRemovedCount += extracted.navRemovedCount;
    tocRemovedCount += extracted.tocRemovedCount;
    poetryFormattingPreserved =
      poetryFormattingPreserved || extracted.poetryFormattingPreserved;

    if (spineItems.length > 1 && extracted.looksLikeToc) {
      tocRemovedCount += 1;
      skippedDocuments.push({
        href: zipPath,
        reason: "duplicate table of contents document"
      });
      continue;
    }

    const title = extracted.title ?? `Section ${chapters.length + 1}`;
    const blocks = withoutDuplicateLeadingHeading(extracted.blocks, title);
    const text = normalizeEpubText(blocks.join("\n\n"));

    if (!text) {
      skippedDocuments.push({
        href: zipPath,
        reason: "no readable text after boilerplate removal"
      });
      continue;
    }

    chapters.push({
      order: chapters.length + 1,
      title,
      href: zipPath,
      manifestId: manifestItem.id,
      text,
      wordCount: countWords(text)
    });
  }

  if (chapters.length === 0) {
    throw new Error("No readable spine documents were found inside the EPUB.");
  }

  const extractedDocumentCount = chapters.length;
  const titleCardMerge = mergeDuplicateTitleCards(chapters);
  if (titleCardMerge.mergedCount > 0) {
    chapters.splice(0, chapters.length, ...titleCardMerge.chapters);
    warnings.push(
      `${titleCardMerge.mergedCount} EPUB title card section(s) were merged with following content.`
    );
  }

  if (skippedDocuments.length > 0) {
    warnings.push(`${skippedDocuments.length} EPUB spine document(s) were skipped.`);
  }

  const rawText = chapters
    .map((chapter) => `# ${chapter.title}\n\n${chapter.text}`)
    .join("\n\n");
  const cleanedText = normalizeEpubText(rawText);
  const extractionWarnings = Array.from(new Set(warnings));
  const extractionReport: EpubExtractionReport = {
    format: "EPUB",
    sourceFormat: "EPUB",
    fileName,
    rootfilePath: opfPath,
    spineItemCount: spineItems.length,
    extractedDocumentCount,
    skippedDocumentCount: skippedDocuments.length,
    skippedDocuments,
    detectedTitle: metadata.title,
    detectedAuthor: metadata.author,
    detectedLanguage: metadata.language,
    detectedPublisher: metadata.publisher,
    detectedPublicationDate: metadata.publicationDate,
    detectedIdentifier: metadata.identifier,
    warnings: extractionWarnings,
    tocRemoved: tocRemovedCount > 0,
    tocRemovedCount,
    navRemoved: navRemovedCount > 0,
    navRemovedCount,
    poetryFormattingPreserved,
    titleCardMergedCount: titleCardMerge.mergedCount,
    chapters: chapters.map((chapter) => ({
      order: chapter.order,
      title: chapter.title,
      href: chapter.href,
      wordCount: chapter.wordCount
    }))
  };

  return {
    sourceFormat: "EPUB",
    rawText,
    cleanedText,
    chapters,
    extractionWarnings,
    detectedTitle: metadata.title,
    detectedAuthor: metadata.author,
    detectedLanguage: metadata.language,
    detectedPublisher: metadata.publisher,
    detectedPublicationDate: metadata.publicationDate,
    detectedIdentifier: metadata.identifier,
    extractionReport
  };
}

function extractOpfMetadata(metadata: unknown) {
  const record = objectValue(metadata);
  const creators = asArray(record.creator)
    .map((creator) => textValue(creator))
    .filter((creator): creator is string => Boolean(creator));

  return {
    title: textValue(firstValue(record.title)),
    author: creators[0],
    language: textValue(firstValue(record.language)),
    publisher: textValue(firstValue(record.publisher)),
    publicationDate: textValue(firstValue(record.date)),
    identifier: textValue(firstValue(record.identifier))
  };
}

function extractManifestItems(manifest: unknown): ManifestItem[] {
  return asArray(objectValue(manifest).item)
    .map((item) => objectValue(item))
    .map((item) => ({
      id: stringValue(item.id) ?? "",
      href: stringValue(item.href) ?? "",
      mediaType: stringValue(item["media-type"]),
      properties: stringValue(item.properties)
    }))
    .filter((item) => item.id && item.href);
}

function extractSpineItems(spine: unknown): SpineItem[] {
  return asArray(objectValue(spine).itemref)
    .map((item) => objectValue(item))
    .map((item) => ({
      idref: stringValue(item.idref) ?? "",
      linear: stringValue(item.linear)
    }))
    .filter((item) => item.idref);
}

function extractHtmlDocument(html: string): HtmlExtraction {
  const root = parse(html, {
    lowerCaseTagName: true,
    comment: false,
    blockTextElements: {
      script: true,
      style: true,
      pre: true
    }
  });
  const preliminaryTitle = firstHeadingText(root);
  const linkCount = root.querySelectorAll("a").length;
  const navRemovedCount = removeNavigationBoilerplate(root);
  const body = root.querySelector("body") ?? root;
  const title = firstHeadingText(body) ?? preliminaryTitle;
  const extracted = extractBlocks(body);
  const meaningfulBlocks = extracted.blocks
    .map((block) => normalizeEpubText(block))
    .filter(Boolean);
  const embeddedToc = removeEmbeddedTocBlocks(meaningfulBlocks);
  const wordCount = countWords(meaningfulBlocks.join(" "));
  const looksLikeToc =
    linkCount >= 5 &&
    wordCount < 800 &&
    Boolean(title && NAV_WORDS.test(title));
  const inferredTitle =
    title ?? inferTitleFromBlocks(embeddedToc.blocks) ?? preliminaryTitle;

  return {
    title: inferredTitle,
    blocks: embeddedToc.blocks,
    looksLikeToc,
    navRemovedCount,
    tocRemovedCount: (looksLikeToc ? 1 : 0) + (embeddedToc.removed ? 1 : 0),
    poetryFormattingPreserved: extracted.poetryFormattingPreserved
  };
}

function mergeDuplicateTitleCards(chapters: EpubExtractedChapter[]) {
  const merged: EpubExtractedChapter[] = [];
  let mergedCount = 0;

  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    const next = chapters[index + 1];

    if (next && isDuplicateTitleCard(chapter, next)) {
      mergedCount += 1;
      continue;
    }

    merged.push({
      ...chapter,
      order: merged.length + 1
    });
  }

  return {
    chapters: merged,
    mergedCount
  };
}

function isDuplicateTitleCard(
  chapter: EpubExtractedChapter,
  next: EpubExtractedChapter
) {
  if (chapter.wordCount > 24) {
    return false;
  }

  const lines = chapter.text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0 || lines.length > 4) {
    return false;
  }

  const title = titleFromTitleCardLines(lines);
  if (!title) {
    return false;
  }

  return (
    normalizeHeadingForCompare(next.title) === normalizeHeadingForCompare(title) ||
    normalizeHeadingForCompare(firstTextLine(next.text)) === normalizeHeadingForCompare(title)
  );
}

function titleFromTitleCardLines(lines: string[]) {
  return (
    lines.find((line) => !/^([ivxlcdm]+|[0-9]+)[.)]?$/i.test(line)) ?? lines[0]
  );
}

function inferTitleFromBlocks(blocks: string[]) {
  const first = blocks[0];
  const second = blocks[1];

  if (first && /^([ivxlcdm]+|[0-9]+)[.)]?$/i.test(first.trim()) && second) {
    return isShortHeadingLike(second) ? second.trim() : undefined;
  }

  return first && isShortHeadingLike(first) ? first.trim() : undefined;
}

function isShortHeadingLike(input: string) {
  const text = input.trim();
  const words = countWords(text);
  if (words === 0 || words > 14 || text.length > 140) {
    return false;
  }

  if (/[.!?]\s+\p{Lu}/u.test(text)) {
    return false;
  }

  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length < 3) {
    return false;
  }

  const uppercaseLetters = letters.replace(/[^\p{Lu}]/gu, "").length;
  const uppercaseRatio = uppercaseLetters / letters.length;
  const startsWithCapital = /^[\p{Lu}\d]/u.test(text);

  return uppercaseRatio > 0.6 || startsWithCapital;
}

function firstTextLine(text: string) {
  return (
    text
      .split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function removeEmbeddedTocBlocks(blocks: string[]) {
  const tocIndex = blocks.findIndex(
    (block, index) => index <= 20 && /^(contents?|table of contents)$/i.test(block.trim())
  );

  if (tocIndex < 0) {
    return { blocks, removed: false };
  }

  const seenTocEntries = new Set<string>();
  let tocEntryCount = 0;
  const searchEnd = Math.min(blocks.length, tocIndex + 300);

  for (let index = tocIndex + 1; index < searchEnd; index += 1) {
    const normalized = normalizeTocEntry(blocks[index]);
    if (!normalized) {
      continue;
    }

    if (seenTocEntries.has(normalized) && tocEntryCount >= 8) {
      return {
        blocks: [...blocks.slice(0, tocIndex), ...blocks.slice(index)],
        removed: true
      };
    }

    if (isLikelyTocEntry(blocks[index])) {
      seenTocEntries.add(normalized);
      tocEntryCount += 1;
    }
  }

  return { blocks, removed: false };
}

function normalizeTocEntry(input: string) {
  const normalized = input
    .replace(/\s+/g, " ")
    .replace(/\.{2,}\s*\d+$/g, "")
    .trim()
    .toLowerCase();
  return normalized.length >= 3 ? normalized : "";
}

function isLikelyTocEntry(input: string) {
  const text = input.trim();
  return text.length <= 120 && countWords(text) <= 14;
}

function removeNavigationBoilerplate(root: HTMLElement) {
  let removed = 0;
  for (const element of collectElements(root)) {
    const tag = tagName(element);
    if (tag === "script" || tag === "style" || tag === "nav") {
      element.remove();
      removed += 1;
      continue;
    }

    const descriptor = elementDescriptor(element);
    if (
      /\b(page[-_\s]?list|landmarks?|doc-toc|toc|table[-_\s]?of[-_\s]?contents)\b/i.test(
        descriptor
      )
    ) {
      element.remove();
      removed += 1;
    }
  }

  return removed;
}

function extractBlocks(node: HtmlNode, parentIsVerse = false): {
  blocks: string[];
  poetryFormattingPreserved: boolean;
} {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const text = cleanTextBlock(node.text, false);
    return {
      blocks: text ? [text] : [],
      poetryFormattingPreserved: false
    };
  }

  if (node.nodeType !== NodeType.ELEMENT_NODE) {
    return { blocks: [], poetryFormattingPreserved: false };
  }

  const element = node as HTMLElement;
  const tag = tagName(element);

  if (REMOVED_TAGS.has(tag)) {
    return { blocks: [], poetryFormattingPreserved: false };
  }

  const isVerse = parentIsVerse || isVerseLikeElement(element);
  const preserveLineBreaks =
    isVerse ||
    tag === "pre" ||
    hasLineBreakElement(element) ||
    looksLikeVerseText(element.structuredText);
  const shouldExtractWholeBlock =
    HEADING_TAGS.has(tag) ||
    TEXT_BLOCK_TAGS.has(tag) ||
    isVerse ||
    !hasBlockElementChildren(element);

  if (shouldExtractWholeBlock) {
    const sourceText = preserveLineBreaks ? element.structuredText : element.text;
    const text = cleanTextBlock(sourceText, preserveLineBreaks);
    return {
      blocks: text ? [text] : [],
      poetryFormattingPreserved: preserveLineBreaks && text.includes("\n")
    };
  }

  const blocks: string[] = [];
  let poetryFormattingPreserved = false;
  for (const child of element.childNodes) {
    const extracted = extractBlocks(child, isVerse);
    blocks.push(...extracted.blocks);
    poetryFormattingPreserved =
      poetryFormattingPreserved || extracted.poetryFormattingPreserved;
  }

  return { blocks, poetryFormattingPreserved };
}

function indexZip(zip: JSZip): ZipIndex {
  const index = new Map<string, JSZip.JSZipObject>();
  zip.forEach((_relativePath, file) => {
    if (!file.dir) {
      index.set(normalizeZipPath(file.name), file);
    }
  });
  return index;
}

async function readZipText(index: ZipIndex, path: string) {
  const file = index.get(normalizeZipPath(path));
  if (!file) {
    throw new Error(`EPUB archive entry was not found: ${path}`);
  }
  return file.async("text");
}

function findZipPath(index: ZipIndex, wanted: string) {
  const normalized = normalizeZipPath(wanted);
  if (index.has(normalized)) {
    return normalized;
  }

  const decoded = normalizeZipPath(decodeUriPath(normalized));
  if (index.has(decoded)) {
    return decoded;
  }

  const lower = decoded.toLowerCase();
  for (const key of index.keys()) {
    if (key.toLowerCase() === lower) {
      return key;
    }
  }

  return undefined;
}

function resolveZipPath(baseDir: string, href: string) {
  const withoutFragment = href.split("#")[0] ?? href;
  const decoded = decodeUriPath(withoutFragment);
  return normalizeZipPath(baseDir ? `${baseDir}/${decoded}` : decoded);
}

function normalizeZipPath(path: string) {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function decodeUriPath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function dirname(path: string) {
  const normalized = normalizeZipPath(path);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function isHtmlManifestItem(item: ManifestItem) {
  const mediaType = item.mediaType?.toLowerCase();
  return (
    (mediaType ? HTML_MEDIA_TYPES.has(mediaType) : false) ||
    /\.(xhtml|html|htm)$/i.test(item.href)
  );
}

function isNavigationManifestItem(item: ManifestItem, path: string) {
  return Boolean(
    item.properties?.split(/\s+/).includes("nav") || isTocLikePath(path)
  );
}

function isTocLikePath(path: string) {
  return /(^|\/)(nav|toc|contents?|table[-_]?of[-_]?contents|page[-_]?list|landmarks?)\.(xhtml|html|htm)$/i.test(
    path
  );
}

function isSourceBoilerplatePath(path: string) {
  return /(^|\/)[^/]*(colophon|kolofon)[^/]*\.(xhtml|html|htm)$/i.test(path);
}

function firstHeadingText(root: HTMLElement) {
  const heading = root.querySelector("h1") ?? root.querySelector("h2") ?? root.querySelector("h3");
  const text = heading ? cleanTextBlock(heading.text, false) : "";
  return text || undefined;
}

function withoutDuplicateLeadingHeading(blocks: string[], title: string) {
  const [first, ...rest] = blocks;
  if (first && normalizeHeadingForCompare(first) === normalizeHeadingForCompare(title)) {
    return rest;
  }
  return blocks;
}

function normalizeHeadingForCompare(input: string) {
  return input
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasBlockElementChildren(element: HTMLElement) {
  return element.children.some((child) => BLOCK_TAGS.has(tagName(child)));
}

function hasLineBreakElement(element: HTMLElement) {
  return element.querySelector("br") !== null;
}

function isVerseLikeElement(element: HTMLElement) {
  return tagName(element) === "pre" || VERSE_WORDS.test(elementDescriptor(element));
}

function looksLikeVerseText(input: string) {
  const lines = input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3) {
    return false;
  }

  const wordCounts = lines.map((line) => countWords(line));
  const shortLines = wordCounts.filter((words) => words > 0 && words <= 8).length;
  const avgWords =
    wordCounts.reduce((sum, words) => sum + words, 0) / Math.max(1, wordCounts.length);

  return shortLines / lines.length >= 0.65 && avgWords <= 8;
}

function cleanTextBlock(input: string, preserveLineBreaks: boolean) {
  const normalized = input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ");
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

  return preserveLineBreaks ? lines.join("\n").trim() : lines.join(" ").trim();
}

function normalizeEpubText(input: string) {
  return normalizeWhitespace(input)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function collectElements(root: HTMLElement) {
  const elements: HTMLElement[] = [];
  const visit = (node: HtmlNode) => {
    if (node.nodeType !== NodeType.ELEMENT_NODE) {
      return;
    }
    const element = node as HTMLElement;
    elements.push(element);
    for (const child of element.childNodes) {
      visit(child);
    }
  };
  visit(root);
  return elements;
}

function tagName(element: HTMLElement) {
  return (element.rawTagName || element.tagName || "").toLowerCase();
}

function elementDescriptor(element: HTMLElement) {
  return [
    tagName(element),
    element.getAttribute("id"),
    element.getAttribute("class"),
    element.getAttribute("epub:type"),
    element.getAttribute("type"),
    element.getAttribute("role"),
    element.getAttribute("aria-label")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null ? [] : [value];
}

function firstValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text || undefined;
  }

  if (Array.isArray(value)) {
    return textValue(value[0]);
  }

  const record = objectValue(value);
  const text = stringValue(record["#text"]);
  if (text) {
    return text;
  }

  return undefined;
}

function stringValue(value: unknown): string | undefined {
  const text = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : undefined;
  return text || undefined;
}
