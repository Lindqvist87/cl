import {
  ensureManuscriptPipelineJobs,
  type PipelineStartMode
} from "@/lib/pipeline/pipelineJobs";
import { autoContinueManuscriptPipeline } from "@/lib/pipeline/autoContinue";
import {
  getInngestRuntimeConfig,
  INNGEST_EVENTS,
  manuscriptPipelineStartedPayload,
  sendInngestEvent
} from "@/src/inngest/events";

const FALLBACK_MAX_BATCHES = 5;
const FALLBACK_MIN_SECONDS = 120;
const FALLBACK_MAX_ITEMS_PER_STEP = 4;

export async function startManuscriptPipeline(input: {
  manuscriptId: string;
  mode: PipelineStartMode;
  requestedBy?: string | null;
}) {
  const config = getInngestRuntimeConfig();
  const ensured = await ensureManuscriptPipelineJobs(
    input.manuscriptId,
    input.mode
  );
  let event: { sent: boolean; ids: string[]; error: string | null } | null = null;

  if (config.configured && config.canSendEvents) {
    const payload = manuscriptPipelineStartedPayload({
      manuscriptId: input.manuscriptId,
      requestedBy: input.requestedBy,
      mode: input.mode
    });
    event = await sendInngestEvent(
      INNGEST_EVENTS.MANUSCRIPT_PIPELINE_STARTED,
      payload
    );

    if (event.sent) {
      return {
        executionMode: "INNGEST",
        accepted: true,
        manuscriptId: input.manuscriptId,
        runId: ensured.run.id,
        jobCount: ensured.jobs.length,
        eventSent: event.sent,
        eventIds: event.ids,
        eventError: event.error,
        warnings: config.warnings
      };
    }
  }

  const batch = await autoContinueManuscriptPipeline({
    manuscriptId: input.manuscriptId,
    maxBatches: FALLBACK_MAX_BATCHES,
    maxJobsPerBatch: config.maxJobsPerRun,
    maxSeconds: Math.max(config.maxSecondsPerRun, FALLBACK_MIN_SECONDS),
    maxItemsPerStep: FALLBACK_MAX_ITEMS_PER_STEP,
    workerType: "MANUAL",
    workerId: "manual:start-pipeline"
  });

  return {
    executionMode: "MANUAL",
    accepted: false,
    runId: ensured.run.id,
    manuscriptId: input.manuscriptId,
    jobCount: ensured.jobs.length,
    eventSent: event?.sent ?? false,
    eventIds: event?.ids ?? [],
    eventError: event?.error ?? null,
    batch,
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
