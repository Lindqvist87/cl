import {
  ensureManuscriptPipelineJobs,
  runReadyPipelineJobs,
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
  const ensured = await ensureManuscriptPipelineJobs(
    input.manuscriptId,
    input.mode
  );

  if (config.enabled && config.canSendEvents) {
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

  const batch = await runReadyPipelineJobs({
    manuscriptId: input.manuscriptId,
    maxJobs: config.maxJobsPerRun,
    maxSeconds: config.maxSecondsPerRun,
    workerType: "MANUAL",
    workerId: "manual:start-pipeline"
  });

  return {
    executionMode: "MANUAL",
    accepted: false,
    runId: ensured.run.id,
    manuscriptId: input.manuscriptId,
    jobCount: ensured.jobs.length,
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
