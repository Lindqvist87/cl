import mammoth from "mammoth";
import { ManuscriptFormat } from "@prisma/client";
import { normalizeWhitespace } from "@/lib/text/wordCount";

export type ExtractedManuscriptText = {
  text: string;
  format: ManuscriptFormat;
  mimeType?: string;
};

export async function extractTextFromUpload(file: File): Promise<ExtractedManuscriptText> {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type || undefined;
  const buffer = Buffer.from(await file.arrayBuffer());

  if (fileName.endsWith(".txt") || mimeType === "text/plain") {
    return {
      text: normalizeWhitespace(new TextDecoder("utf-8").decode(buffer)),
      format: ManuscriptFormat.TXT,
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
      format: ManuscriptFormat.DOCX,
      mimeType
    };
  }

  throw new Error("Unsupported file type. Upload a .txt or .docx manuscript.");
}
