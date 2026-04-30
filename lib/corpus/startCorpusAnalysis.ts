import {
  ensureCorpusAnalysisJobs,
  getNextEligibleCorpusJob,
  getNextEligibleCorpusJobSelection,
  getCorpusAnalysisSummary,
  releaseStaleCorpusJobLocks,
  type NextEligibleCorpusJobSelection
} from "@/lib/corpus/corpusAnalysisJobs";
import {
  recordWorkerHeartbeat,
  runPipelineJob,
  type RunPipelineJobResult
} from "@/lib/pipeline/pipelineJobs";
import {
  getInngestRuntimeConfig,
  INNGEST_EVENTS,
  sendInngestEvent
} from "@/src/inngest/events";

export type CorpusAnalysisExecutionMode = "INNGEST" | "MANUAL" | "QUEUED";

export async function startCorpusAnalysis(input: {
  corpusBookId: string;
  source: string;
  runFallbackWhenDisabled?: boolean;
  maxJobs?: number;
  maxSeconds?: number;
}) {
  const config = getInngestRuntimeConfig();
  const ensured = await ensureCorpusAnalysisJobs(input.corpusBookId);
  const executionMode = corpusAnalysisExecutionMode({
    inngestEnabled: config.enabled,
    runFallbackWhenDisabled: input.runFallbackWhenDisabled ?? false
  });

  if (executionMode === "INNGEST") {
    const event = await sendInngestEvent(INNGEST_EVENTS.CORPUS_IMPORT_REQUESTED, {
      corpusBookId: input.corpusBookId,
      source: input.source
    });

    return {
      executionMode,
      accepted: event.sent,
      corpusBookId: input.corpusBookId,
      jobCount: ensured.jobs.length,
      eventSent: event.sent,
      eventIds: event.ids,
      eventError: event.error,
      warnings: config.warnings,
      summary: await getCorpusAnalysisSummary(input.corpusBookId)
    };
  }

  if (executionMode === "MANUAL") {
    const batch = await runReadyCorpusAnalysisJobs({
      corpusBookId: input.corpusBookId,
      maxJobs: input.maxJobs ?? 50,
      maxSeconds: input.maxSeconds ?? 280
    });

    return {
      executionMode,
      accepted: false,
      corpusBookId: input.corpusBookId,
      jobCount: ensured.jobs.length,
      eventSent: false,
      eventIds: [] as string[],
      eventError: null,
      warnings: config.warnings,
      batch,
      summary: await getCorpusAnalysisSummary(input.corpusBookId)
    };
  }

  return {
    executionMode,
    accepted: false,
    corpusBookId: input.corpusBookId,
    jobCount: ensured.jobs.length,
    eventSent: false,
    eventIds: [] as string[],
    eventError: null,
    warnings: config.warnings,
    summary: await getCorpusAnalysisSummary(input.corpusBookId)
  };
}

export async function runReadyCorpusAnalysisJobs(input: {
  corpusBookId: string;
  maxJobs?: number;
  maxSeconds?: number;
  workerType?: "INNGEST" | "MANUAL";
  workerId?: string;
}) {
  const maxJobs = positiveInt(input.maxJobs, 50);
  const maxSeconds = positiveInt(input.maxSeconds, 280);
  const workerType = input.workerType ?? "MANUAL";
  const startedAt = Date.now();
  const results: RunPipelineJobResult[] = [];
  const readyJobIds: string[] = [];

  await recordWorkerHeartbeat(workerType, "RUNNING", {
    task: "corpus-analysis",
    corpusBookId: input.corpusBookId
  });
  await releaseStaleCorpusJobLocks(input.corpusBookId);

  while (results.length < maxJobs && Date.now() - startedAt < maxSeconds * 1000) {
    const nextRun = await runNextEligibleCorpusJob({
      corpusBookId: input.corpusBookId,
      workerType,
      workerId: input.workerId,
      recordHeartbeat: false,
      releaseStaleLocks: false
    });
    const result = nextRun.results[0];
    if (!result) {
      break;
    }

    results.push(result);
    readyJobIds.push(...result.readyJobIds);

    if (result.status === "locked") {
      break;
    }
  }

  const remainingReadyJobs = await countRemainingReadyCorpusJobs(input.corpusBookId);
  const hitRunLimit =
    results.length >= maxJobs || Date.now() - startedAt >= maxSeconds * 1000;
  await recordWorkerHeartbeat(workerType, "IDLE", {
    task: "corpus-analysis",
    corpusBookId: input.corpusBookId,
    jobsRun: results.length,
    remainingReadyJobs
  });

  return {
    jobsRun: results.length,
    results,
    readyJobIds: Array.from(new Set(readyJobIds)),
    remainingReadyJobs,
    hasRemainingWork:
      remainingReadyJobs > 0 || (hitRunLimit && readyJobIds.length > 0)
  };
}

export async function runNextEligibleCorpusJob(input: {
  corpusBookId: string;
  workerType?: "INNGEST" | "MANUAL";
  workerId?: string;
  recordHeartbeat?: boolean;
  releaseStaleLocks?: boolean;
  runJob?: typeof runPipelineJob;
}) {
  const workerType = input.workerType ?? "MANUAL";
  const shouldRecordHeartbeat = input.recordHeartbeat ?? true;

  if (shouldRecordHeartbeat) {
    await recordWorkerHeartbeat(workerType, "RUNNING", {
      task: "corpus-analysis",
      corpusBookId: input.corpusBookId
    });
  }

  if (input.releaseStaleLocks ?? true) {
    await releaseStaleCorpusJobLocks(input.corpusBookId);
  }

  const selection = await getNextEligibleCorpusJobSelection(input.corpusBookId);
  logNextEligibleCorpusJobSelection(input.corpusBookId, selection);

  if (!selection.job) {
    if (shouldRecordHeartbeat) {
      await recordWorkerHeartbeat(workerType, "IDLE", {
        task: "corpus-analysis",
        corpusBookId: input.corpusBookId,
        jobsRun: 0,
        remainingReadyJobs: 0,
        nextEligibleJobReason: selection.reason
      });
    }

    return {
      jobsRun: 0,
      results: [] as RunPipelineJobResult[],
      readyJobIds: [] as string[],
      remainingReadyJobs: 0,
      hasRemainingWork: false,
      nextEligibleJob: null,
      nextEligibleJobReason: selection.reason
    };
  }

  const runJob = input.runJob ?? runPipelineJob;
  const result = await runJob(selection.job.id, {
    workerId: input.workerId ?? `${workerType.toLowerCase()}-corpus:${Date.now()}`
  });
  const remainingReadyJobs = await countRemainingReadyCorpusJobs(input.corpusBookId);
  const readyJobIds = Array.from(new Set(result.readyJobIds));

  if (shouldRecordHeartbeat) {
    await recordWorkerHeartbeat(workerType, "IDLE", {
      task: "corpus-analysis",
      corpusBookId: input.corpusBookId,
      jobsRun: 1,
      remainingReadyJobs,
      nextEligibleJob: {
        id: selection.job.id,
        type: selection.job.type,
        status: selection.job.status
      },
      nextEligibleJobReason: selection.reason
    });
  }

  return {
    jobsRun: 1,
    results: [result],
    readyJobIds,
    remainingReadyJobs,
    hasRemainingWork: remainingReadyJobs > 0 || readyJobIds.length > 0,
    nextEligibleJob: {
      id: selection.job.id,
      type: selection.job.type,
      status: selection.job.status
    },
    nextEligibleJobReason: selection.reason
  };
}

export function corpusAnalysisExecutionMode(input: {
  inngestEnabled: boolean;
  runFallbackWhenDisabled: boolean;
}): CorpusAnalysisExecutionMode {
  if (input.inngestEnabled) {
    return "INNGEST";
  }

  return input.runFallbackWhenDisabled ? "MANUAL" : "QUEUED";
}

export function corpusAnalysisHttpStatus(result: {
  executionMode: CorpusAnalysisExecutionMode;
  accepted: boolean;
}) {
  if (result.executionMode === "INNGEST") {
    return result.accepted ? 202 : 503;
  }

  return 200;
}

async function countRemainingReadyCorpusJobs(corpusBookId: string) {
  let count = 0;
  while (await getNextEligibleCorpusJob(corpusBookId)) {
    count += 1;
    break;
  }
  return count;
}

function logNextEligibleCorpusJobSelection(
  corpusBookId: string,
  selection: NextEligibleCorpusJobSelection
) {
  console.info("Corpus pipeline next eligible job selection", {
    corpusBookId,
    nextEligibleJob: selection.job
      ? {
          id: selection.job.id,
          type: selection.job.type,
          status: selection.job.status
        }
      : null,
    reason: selection.reason,
    inspectedJobCount: selection.inspectedJobCount
  });
}

function positiveInt(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}
