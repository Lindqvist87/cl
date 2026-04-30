import { NextResponse } from "next/server";
import { ensureCorpusAnalysisJobs } from "@/lib/corpus/corpusAnalysisJobs";
import { ensureManuscriptPipelineJobs } from "@/lib/pipeline/pipelineJobs";
import { prisma } from "@/lib/prisma";
import { requireAdminJobToken } from "@/lib/server/adminJobAuth";
import {
  INNGEST_EVENTS,
  manuscriptPipelineStartedPayload,
  sendInngestEvent
} from "@/src/inngest/events";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireAdminJobToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await request.json().catch(() => ({}));
  const corpusBookId = stringOrUndefined(body.corpusBookId);
  const manuscriptId = stringOrUndefined(body.manuscriptId);

  if (corpusBookId) {
    const book = await prisma.corpusBook.findUnique({
      where: { id: corpusBookId },
      select: { id: true, sourceId: true }
    });

    if (!book) {
      return NextResponse.json(
        { error: "Corpus book not found." },
        { status: 404 }
      );
    }

    await ensureCorpusAnalysisJobs(book.id);
    const payload = {
      corpusBookId: book.id,
      source: book.sourceId
    };
    const event = await sendInngestEvent(
      INNGEST_EVENTS.CORPUS_IMPORT_REQUESTED,
      payload
    );

    return NextResponse.json({
      corpusBookId: book.id,
      eventSent: event.sent,
      eventIds: event.ids,
      eventError: event.error
    });
  }

  if (!manuscriptId) {
    return NextResponse.json(
      { error: "manuscriptId or corpusBookId is required." },
      { status: 400 }
    );
  }

  await ensureManuscriptPipelineJobs(manuscriptId, "RESUME");
  const payload = manuscriptPipelineStartedPayload({
    manuscriptId,
    mode: "RESUME"
  });
  const event = await sendInngestEvent(
    INNGEST_EVENTS.MANUSCRIPT_PIPELINE_STARTED,
    payload
  );

  return NextResponse.json({
    manuscriptId,
    eventSent: event.sent,
    eventIds: event.ids,
    eventError: event.error
  });
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}
