import AdmZip from "adm-zip";
import mammoth from "mammoth";
import { normalizeWhitespace } from "@/lib/text/wordCount";

export type CorpusTextFormat = "TXT" | "MD" | "XML" | "EPUB" | "DOCX";

export type ExtractedCorpusText = {
  text: string;
  format: CorpusTextFormat;
  mimeType?: string;
};

export async function extractTextFromCorpusUpload(
  file: File
): Promise<ExtractedCorpusText> {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type || undefined;
  const buffer = Buffer.from(await file.arrayBuffer());

  if (fileName.endsWith(".txt") || mimeType === "text/plain") {
    return {
      text: normalizeWhitespace(decodeUtf8(buffer)),
      format: "TXT",
      mimeType
    };
  }

  if (fileName.endsWith(".md") || mimeType === "text/markdown") {
    return {
      text: normalizeWhitespace(markdownToText(decodeUtf8(buffer))),
      format: "MD",
      mimeType
    };
  }

  if (
    fileName.endsWith(".xml") ||
    fileName.endsWith(".tei") ||
    mimeType === "application/xml" ||
    mimeType === "text/xml"
  ) {
    return {
      text: normalizeWhitespace(markupToText(decodeUtf8(buffer))),
      format: "XML",
      mimeType
    };
  }

  if (fileName.endsWith(".epub") || mimeType === "application/epub+zip") {
    return {
      text: normalizeWhitespace(extractEpubText(buffer)),
      format: "EPUB",
      mimeType
    };
  }

  if (
    fileName.endsWith(".docx") ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: normalizeWhitespace(result.value),
      format: "DOCX",
      mimeType
    };
  }

  throw new Error("Unsupported corpus file type. Upload TXT, Markdown, XML, EPUB, or DOCX.");
}

function decodeUtf8(buffer: Buffer) {
  return new TextDecoder("utf-8").decode(buffer);
}

function markdownToText(input: string) {
  return input
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~]{1,3}/g, "");
}

function extractEpubText(buffer: Buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .filter((entry) => /\.(xhtml|html|htm|xml)$/i.test(entry.entryName))
    .filter((entry) => !/(^|\/)(toc|nav|content|container)\.(xhtml|html|htm|xml|opf)$/i.test(entry.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));

  const text = entries
    .map((entry) => markupToText(entry.getData().toString("utf8")))
    .filter(Boolean)
    .join("\n\n");

  if (!text.trim()) {
    throw new Error("No readable text files were found inside the EPUB.");
  }

  return text;
}

function markupToText(input: string) {
  return decodeEntities(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/(p|div|section|chapter|lg|l|h[1-6]|title|head|br)>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
  ).trim();
}

function decodeEntities(input: string) {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2019;/gi, "\u2019")
    .replace(/&#x201c;/gi, "\u201c")
    .replace(/&#x201d;/gi, "\u201d");
}
