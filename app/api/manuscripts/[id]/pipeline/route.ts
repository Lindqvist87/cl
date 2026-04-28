import { NextResponse } from "next/server";
import { runFullManuscriptPipeline } from "@/lib/pipeline/manuscriptPipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const run = await runFullManuscriptPipeline(id);
    return NextResponse.json({
      runId: run.id,
      manuscriptId: run.manuscriptId,
      status: run.status
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Full manuscript pipeline failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
