import { NextResponse } from "next/server";
import { ensureChapterRewriteJob } from "@/lib/pipeline/pipelineJobs";
import { regenerateChapterRewrite } from "@/lib/rewrite/chapterRewrite";
import {
  getInngestRuntimeConfig,
  INNGEST_EVENTS,
  sendInngestEvent
} from "@/src/inngest/events";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; chapterId: string }> }
) {
  const { id, chapterId } = await params;

  try {
    const config = getInngestRuntimeConfig();
    if (config.enabled && config.canSendEvents) {
      const job = await ensureChapterRewriteJob({
        manuscriptId: id,
        chapterId
      });
      const event = await sendInngestEvent(
        INNGEST_EVENTS.CHAPTER_REWRITE_REQUESTED,
        {
          manuscriptId: id,
          chapterId,
          rewritePlanId: null
        }
      );

      return NextResponse.json(
        {
          executionMode: "INNGEST",
          accepted: true,
          jobId: job.id,
          manuscriptId: id,
          chapterId,
          eventSent: event.sent,
          eventIds: event.ids,
          eventError: event.error,
          warnings: config.warnings
        },
        { status: 202 }
      );
    }

    const { rewrite } = await regenerateChapterRewrite(id, chapterId);
    return NextResponse.json({
      executionMode: "MANUAL",
      rewriteId: rewrite.id,
      manuscriptId: rewrite.manuscriptId,
      chapterId: rewrite.chapterId,
      version: rewrite.version,
      status: rewrite.status
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Chapter rewrite failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
