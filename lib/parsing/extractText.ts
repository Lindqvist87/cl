import mammoth from "mammoth";
import { ManuscriptFormat } from "@prisma/client";
import { hashText } from "@/lib/compiler/hash";
import {
  importManifestToPagedDocumentText,
  stripDocumentPageMarkers
} from "@/lib/document/pageMarkers";
import {
  importManifestToNormalizedText
} from "@/lib/import/v2/manifest";
import { parseDocxToImportManifest } from "@/lib/import/v2/docx";
import { buildTextImportManifest } from "@/lib/import/v2/text";
import {
  TEXT_IMPORT_PARSER_VERSION,
  type ImportManifest
} from "@/lib/import/v2/types";
import { countWords } from "@/lib/text/wordCount";

export const MAX_MANUSCRIPT_UPLOAD_BYTES = 25 * 1024 * 1024;

const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const GENERIC_BINARY_MIME_TYPES = new Set([
  "",
  "application/zip",
  "application/octet-stream",
  "application/x-zip-compressed"
]);

export type ExtractedManuscriptText = {
  text: string;
  format: ManuscriptFormat;
  mimeType?: string;
  importManifest?: ImportManifest;
};

type UploadFormat = "docx";

export function validateManuscriptUploadFile(file: File) {
  if (file.size <= 0) {
    throw new Error("The uploaded manuscript file is empty.");
  }

  if (file.size > MAX_MANUSCRIPT_UPLOAD_BYTES) {
    throw new Error(
      `The uploaded manuscript is too large. Maximum size is ${Math.floor(
        MAX_MANUSCRIPT_UPLOAD_BYTES / (1024 * 1024)
      )} MB.`
    );
  }

  detectUploadFormat(file.name, file.type || undefined);
}

export function validateExtractedManuscriptText(
  extracted: ExtractedManuscriptText
) {
  if (countWords(stripDocumentPageMarkers(extracted.text)) === 0) {
    throw new Error("No readable manuscript text was found in the uploaded file.");
  }
}

export async function extractTextFromUpload(file: File): Promise<ExtractedManuscriptText> {
  validateManuscriptUploadFile(file);

  const mimeType = file.type || undefined;
  const buffer = Buffer.from(await file.arrayBuffer());
  const format = detectUploadFormat(file.name, mimeType);

  validateFormatSignature(format, buffer);

  if (format === "docx") {
    try {
      const importManifest = await parseDocxToImportManifest({
        buffer,
        sourceFileName: file.name,
        sourceMimeType: mimeType
      });
      const structuredText = importManifestToNormalizedText(importManifest);
      const guarded = await docxCoverageGuard({
        buffer,
        structuredText,
        sourceFileName: file.name,
        sourceMimeType: mimeType
      });

      if (guarded) {
        return {
          text: importManifestToPagedDocumentText(guarded),
          format: ManuscriptFormat.DOCX,
          mimeType,
          importManifest: guarded
        };
      }

      return {
        text: importManifestToPagedDocumentText(importManifest),
        format: ManuscriptFormat.DOCX,
        mimeType,
        importManifest
      };
    } catch (structuredError) {
      const result = await mammoth.extractRawText({ buffer });
      const importManifest = buildTextImportManifest({
        rawText: result.value,
        sourceFileName: file.name,
        sourceMimeType: mimeType,
        parserVersion: `${TEXT_IMPORT_PARSER_VERSION}-docx-raw-fallback`,
        fileHash: hashText(buffer.toString("base64")),
        warnings: [
          {
            code: "docx_structured_parse_failed",
            message:
              structuredError instanceof Error
                ? structuredError.message
                : "Structured DOCX parse failed; raw text fallback was used.",
            severity: "warning"
          }
        ]
      });

      return {
        text: importManifestToPagedDocumentText(importManifest),
        format: ManuscriptFormat.DOCX,
        mimeType,
        importManifest
      };
    }
  }

  throw new Error("Unsupported file type. Upload a .docx manuscript.");
}

function detectUploadFormat(
  sourceFileName: string,
  sourceMimeType?: string
): UploadFormat {
  const fileName = sourceFileName.toLowerCase();
  const mimeType = (sourceMimeType ?? "").toLowerCase();
  const extensionFormat = fileName.endsWith(".docx") ? "docx" : null;
  const mimeFormat = mimeType === DOCX_MIME_TYPE ? "docx" : null;
  const hasUnsupportedNamedExtension =
    /\.[a-z0-9]+$/i.test(fileName) && !extensionFormat;

  if (hasUnsupportedNamedExtension) {
    throw new Error("Unsupported file type. Upload a .docx manuscript.");
  }

  if (extensionFormat && mimeFormat && extensionFormat !== mimeFormat) {
    throw new Error(
      "The manuscript file extension does not match its MIME type."
    );
  }

  if (mimeType && !mimeFormat && !GENERIC_BINARY_MIME_TYPES.has(mimeType)) {
    throw new Error("Unsupported file type. Upload a .docx manuscript.");
  }

  const format = extensionFormat ?? mimeFormat;
  if (!format) {
    throw new Error("Unsupported file type. Upload a .docx manuscript.");
  }

  return format;
}

function validateFormatSignature(format: UploadFormat, buffer: Buffer) {
  const looksLikeZip = hasZipSignature(buffer);

  if (format === "docx" && !looksLikeZip) {
    throw new Error("The DOCX file does not look like a valid .docx archive.");
  }

}

function hasZipSignature(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return false;
  }

  return (
    (buffer[2] === 0x03 && buffer[3] === 0x04) ||
    (buffer[2] === 0x05 && buffer[3] === 0x06) ||
    (buffer[2] === 0x07 && buffer[3] === 0x08)
  );
}

async function docxCoverageGuard(input: {
  buffer: Buffer;
  structuredText: string;
  sourceFileName: string;
  sourceMimeType?: string;
}): Promise<ImportManifest | null> {
  const structuredWords = countWords(input.structuredText);
  let rawText = "";
  try {
    rawText = (await mammoth.extractRawText({ buffer: input.buffer })).value;
  } catch {
    return null;
  }

  const rawWords = countWords(rawText);
  const missingEnoughText = rawWords >= structuredWords + 1000;
  const lowCoverage =
    rawWords >= 2000 && structuredWords / Math.max(rawWords, 1) < 0.65;

  if (!missingEnoughText || !lowCoverage) {
    return null;
  }

  return buildTextImportManifest({
    rawText,
    sourceFileName: input.sourceFileName,
    sourceMimeType: input.sourceMimeType,
    parserVersion: `${TEXT_IMPORT_PARSER_VERSION}-docx-coverage-fallback`,
    fileHash: hashText(input.buffer.toString("base64")),
    warnings: [
      {
        code: "docx_structured_coverage_low",
        message:
          "Structured DOCX import extracted much less text than raw DOCX extraction; raw text fallback was used to avoid truncating the manuscript.",
        severity: "critical",
        metadata: {
          structuredWords,
          rawWords,
          coverageRatio: structuredWords / Math.max(rawWords, 1)
        }
      }
    ]
  });
}
