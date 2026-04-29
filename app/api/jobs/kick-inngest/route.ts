import { NextResponse } from "next/server";
import { ensureManuscriptPipelineJobs } from "@/lib/pipeline/pipelineJobs";
import {
  INNGEST_EVENTS,
  manuscriptPipelineStartedPayload,
  sendInngestEvent
} from "@/src/inngest/events";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.manuscriptId !== "string" || !body.manuscriptId) {
    return NextResponse.json(
      { error: "manuscriptId is required." },
      { status: 400 }
    );
  }

  await ensureManuscriptPipelineJobs(body.manuscriptId, "RESUME");
  const payload = manuscriptPipelineStartedPayload({
    manuscriptId: body.manuscriptId,
    mode: "RESUME"
  });
  const event = await sendInngestEvent(
    INNGEST_EVENTS.MANUSCRIPT_PIPELINE_STARTED,
    payload
  );

  return NextResponse.json({
    manuscriptId: body.manuscriptId,
    eventSent: event.sent,
    eventIds: event.ids,
    eventError: event.error
  });
}
