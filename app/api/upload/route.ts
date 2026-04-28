import { NextResponse } from "next/server";
import { extractTextFromUpload } from "@/lib/parsing/extractText";
import { parseManuscriptText } from "@/lib/parsing/chapterDetector";
import { chunkParsedManuscript } from "@/lib/parsing/chunker";
import { createStoredManuscript } from "@/lib/storage/manuscripts";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing manuscript file." }, { status: 400 });
  }

  try {
    const extracted = await extractTextFromUpload(file);
    const parsed = parseManuscriptText(extracted.text, file.name);
    const chunks = chunkParsedManuscript(parsed);
    const manuscript = await createStoredManuscript({
      parsed,
      chunks,
      sourceFileName: file.name,
      sourceMimeType: extracted.mimeType,
      sourceFormat: extracted.format,
      authorName: textField(formData, "authorName"),
      targetGenre: textField(formData, "targetGenre"),
      targetAudience: textField(formData, "targetAudience")
    });

    return NextResponse.json({
      manuscriptId: manuscript.id,
      title: manuscript.title,
      wordCount: manuscript.wordCount,
      chapterCount: manuscript.chapterCount,
      chunkCount: manuscript.chunkCount
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to upload manuscript.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function textField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
