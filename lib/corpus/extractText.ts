import mammoth from "mammoth";
import {
  extractTextFromEpubBuffer,
  type EpubExtractedChapter,
  type EpubExtractionReport
} from "@/lib/corpus/epub";
import { normalizeWhitespace } from "@/lib/text/wordCount";

export type CorpusTextFormat = "TXT" | "MD" | "XML" | "EPUB" | "DOCX";

export type ExtractedCorpusText = {
  text: string;
  rawText: string;
  cleanedText: string;
  format: CorpusTextFormat;
  mimeType?: string;
  chapters?: EpubExtractedChapter[];
  extractionReport?: EpubExtractionReport;
  detectedTitle?: string;
  detectedAuthor?: string;
  detectedLanguage?: string;
  detectedPublisher?: string;
  detectedPublicationDate?: string;
  detectedIdentifier?: string;
  extractionWarnings?: string[];
};

export async function extractTextFromCorpusUpload(
  file: File
): Promise<ExtractedCorpusText> {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type || undefined;
  const buffer = Buffer.from(await file.arrayBuffer());

  if (fileName.endsWith(".txt") || mimeType === "text/plain") {
    const rawText = decodeUtf8(buffer);
    const cleanedText = normalizeWhitespace(rawText);
    return {
      text: cleanedText,
      rawText,
      cleanedText,
      format: "TXT",
      mimeType
    };
  }

  if (fileName.endsWith(".md") || mimeType === "text/markdown") {
    const rawText = markdownToText(decodeUtf8(buffer));
    const cleanedText = normalizeWhitespace(rawText);
    return {
      text: cleanedText,
      rawText,
      cleanedText,
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
    const rawText = markupToText(decodeUtf8(buffer));
    const cleanedText = normalizeWhitespace(rawText);
    return {
      text: cleanedText,
      rawText,
      cleanedText,
      format: "XML",
      mimeType
    };
  }

  if (fileName.endsWith(".epub") || mimeType === "application/epub+zip") {
    const epub = await extractTextFromEpubBuffer(buffer, file.name);
    return {
      text: epub.cleanedText,
      rawText: epub.rawText,
      cleanedText: epub.cleanedText,
      format: "EPUB",
      mimeType,
      chapters: epub.chapters,
      extractionReport: epub.extractionReport,
      detectedTitle: epub.detectedTitle,
      detectedAuthor: epub.detectedAuthor,
      detectedLanguage: epub.detectedLanguage,
      detectedPublisher: epub.detectedPublisher,
      detectedPublicationDate: epub.detectedPublicationDate,
      detectedIdentifier: epub.detectedIdentifier,
      extractionWarnings: epub.extractionWarnings
    };
  }

  if (
    fileName.endsWith(".docx") ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    const cleanedText = normalizeWhitespace(result.value);
    return {
      text: cleanedText,
      rawText: result.value,
      cleanedText,
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
