import { runFullManuscriptPipeline } from "@/lib/pipeline/manuscriptPipeline";
import {
  ensureManuscriptPipelineJobs,
  type PipelineStartMode
} from "@/lib/pipeline/pipelineJobs";
import {
  getInngestRuntimeConfig,
  INNGEST_EVENTS,
  manuscriptPipelineStartedPayload,
  sendInngestEvent
} from "@/src/inngest/events";

export async function startManuscriptPipeline(input: {
  manuscriptId: string;
  mode: PipelineStartMode;
  requestedBy?: string | null;
}) {
  const config = getInngestRuntimeConfig();

  if (config.enabled && config.canSendEvents) {
    const ensured = await ensureManuscriptPipelineJobs(input.manuscriptId, input.mode);
    const payload = manuscriptPipelineStartedPayload({
      manuscriptId: input.manuscriptId,
      requestedBy: input.requestedBy,
      mode: input.mode
    });
    const event = await sendInngestEvent(
      INNGEST_EVENTS.MANUSCRIPT_PIPELINE_STARTED,
      payload
    );

    return {
      executionMode: "INNGEST",
      accepted: event.sent,
      manuscriptId: input.manuscriptId,
      runId: ensured.run.id,
      jobCount: ensured.jobs.length,
      eventSent: event.sent,
      eventIds: event.ids,
      eventError: event.error,
      warnings: config.warnings
    };
  }

  const run = await runFullManuscriptPipeline(input.manuscriptId);
  return {
    executionMode: "MANUAL",
    accepted: false,
    runId: run.id,
    manuscriptId: run.manuscriptId,
    status: run.status,
    warnings: config.warnings
  };
}

export function pipelineStartHttpStatus(result: {
  executionMode: string;
  accepted: boolean;
}) {
  if (result.executionMode === "INNGEST") {
    return result.accepted ? 202 : 503;
  }

  return 200;
}
