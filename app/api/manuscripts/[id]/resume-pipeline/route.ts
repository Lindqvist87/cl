import { NextResponse } from "next/server";
import {
  pipelineStartHttpStatus,
  startManuscriptPipeline
} from "@/lib/pipeline/startPipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await startManuscriptPipeline({
      manuscriptId: id,
      mode: "RESUME"
    });
    return NextResponse.json(result, {
      status: pipelineStartHttpStatus(result)
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Pipeline resume failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
