import { NextResponse } from "next/server";
import {
  ensureChapterRewriteDraftsJob,
  runReadyPipelineJobs
} from "@/lib/pipeline/pipelineJobs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  try {
    const job = await ensureChapterRewriteDraftsJob(id);
    const batch = await runReadyPipelineJobs({
      manuscriptId: id,
      maxJobs: 1,
      maxSeconds: numberOrDefault(body.maxSeconds, 240),
      maxItemsPerStep: numberOrDefault(body.maxItemsPerStep, 4),
      workerType: "MANUAL",
      workerId: `manual:rewrite-drafts:${id}`
    });

    return NextResponse.json({
      jobId: job.id,
      manuscriptId: id,
      ...batch
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Chapter rewrite draft generation failed.";
    const status = message === "Manuscript not found." ? 404 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

function numberOrDefault(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback;
}
