import { NextResponse } from "next/server";
import { ensureChapterRewriteJob } from "@/lib/pipeline/pipelineJobs";
import { prisma } from "@/lib/prisma";
import { rewriteFirstChapter } from "@/lib/rewrite/chapterRewrite";
import {
  getInngestRuntimeConfig,
  INNGEST_EVENTS,
  sendInngestEvent
} from "@/src/inngest/events";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const config = getInngestRuntimeConfig();
    if (config.enabled && config.canSendEvents) {
      const chapter = await prisma.manuscriptChapter.findFirst({
        where: { manuscriptId: id },
        orderBy: { order: "asc" },
        select: { id: true }
      });

      if (!chapter) {
        return NextResponse.json(
          { error: "No first chapter found." },
          { status: 404 }
        );
      }

      const job = await ensureChapterRewriteJob({
        manuscriptId: id,
        chapterId: chapter.id
      });
      const event = await sendInngestEvent(
        INNGEST_EVENTS.CHAPTER_REWRITE_REQUESTED,
        {
          manuscriptId: id,
          chapterId: chapter.id,
          rewritePlanId: null
        }
      );

      return NextResponse.json(
        {
          executionMode: "INNGEST",
          accepted: true,
          jobId: job.id,
          manuscriptId: id,
          chapterId: chapter.id,
          eventSent: event.sent,
          eventIds: event.ids,
          eventError: event.error,
          warnings: config.warnings
        },
        { status: 202 }
      );
    }

    const { rewrite } = await rewriteFirstChapter(id);
    return NextResponse.json({
      executionMode: "MANUAL",
      rewriteId: rewrite.id,
      manuscriptId: rewrite.manuscriptId
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Chapter rewrite failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
