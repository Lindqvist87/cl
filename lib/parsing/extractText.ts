import mammoth from "mammoth";
import { ManuscriptFormat } from "@prisma/client";
import { hashText } from "@/lib/compiler/hash";
import {
  importManifestToNormalizedText
} from "@/lib/import/v2/manifest";
import { parseDocxToImportManifest } from "@/lib/import/v2/docx";
import { buildTextImportManifest } from "@/lib/import/v2/text";
import {
  TEXT_IMPORT_PARSER_VERSION,
  type ImportManifest
} from "@/lib/import/v2/types";
import { countWords, normalizeWhitespace } from "@/lib/text/wordCount";

export type ExtractedManuscriptText = {
  text: string;
  format: ManuscriptFormat;
  mimeType?: string;
  importManifest?: ImportManifest;
};

export async function extractTextFromUpload(file: File): Promise<ExtractedManuscriptText> {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type || undefined;
  const buffer = Buffer.from(await file.arrayBuffer());

  if (fileName.endsWith(".txt") || mimeType === "text/plain") {
    const text = normalizeWhitespace(new TextDecoder("utf-8").decode(buffer));
    const importManifest = buildTextImportManifest({
      rawText: text,
      sourceFileName: file.name,
      sourceMimeType: mimeType,
      fileHash: hashText(buffer.toString("utf8"))
    });

    return {
      text: importManifestToNormalizedText(importManifest),
      format: ManuscriptFormat.TXT,
      mimeType,
      importManifest
    };
  }

  if (
    fileName.endsWith(".docx") ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
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
          text: importManifestToNormalizedText(guarded),
          format: ManuscriptFormat.DOCX,
          mimeType,
          importManifest: guarded
        };
      }

      return {
        text: structuredText,
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
        text: importManifestToNormalizedText(importManifest),
        format: ManuscriptFormat.DOCX,
        mimeType,
        importManifest
      };
    }
  }

  throw new Error("Unsupported file type. Upload a .txt or .docx manuscript.");
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
