import { NextResponse } from "next/server";
import { extractTextFromUpload } from "@/lib/parsing/extractText";
import {
  pipelineStartHttpStatus,
  startManuscriptPipeline
} from "@/lib/pipeline/startPipeline";
import { createUploadedManuscriptShell } from "@/lib/storage/manuscripts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing manuscript file." }, { status: 400 });
  }

  try {
    const extracted = await extractTextFromUpload(file);
    const manuscript = await createUploadedManuscriptShell({
      originalText: extracted.text,
      sourceFileName: file.name,
      sourceMimeType: extracted.mimeType,
      sourceFormat: extracted.format,
      authorName: textField(formData, "authorName"),
      targetGenre: textField(formData, "targetGenre"),
      targetAudience: textField(formData, "targetAudience")
    });

    const pipeline = await startManuscriptPipeline({
      manuscriptId: manuscript.id,
      mode: "FULL_PIPELINE",
      requestedBy: "upload",
      runInlineWhenInngestDisabled: false
    });

    return NextResponse.json(
      {
        manuscriptId: manuscript.id,
        title: manuscript.title,
        wordCount: manuscript.wordCount,
        status: manuscript.status,
        executionMode: pipeline.executionMode,
        message: "Import started",
        pipeline
      },
      { status: pipelineStartHttpStatus(pipeline) }
    );
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
