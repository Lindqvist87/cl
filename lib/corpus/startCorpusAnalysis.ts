import {
  ensureCorpusAnalysisJobs,
  findNextReadyCorpusJob,
  getCorpusAnalysisSummary
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

  while (results.length < maxJobs && Date.now() - startedAt < maxSeconds * 1000) {
    const nextJob = await findNextReadyCorpusJob(input.corpusBookId);
    if (!nextJob) {
      break;
    }

    const result = await runPipelineJob(nextJob.id, {
      workerId: input.workerId ?? `${workerType.toLowerCase()}-corpus:${Date.now()}`
    });
    results.push(result);
    readyJobIds.push(...result.readyJobIds);

    if (result.status === "locked") {
      break;
    }
  }

  const remainingReadyJobs = await countRemainingReadyCorpusJobs(input.corpusBookId);
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
    hasRemainingWork: remainingReadyJobs > 0
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
  while (await findNextReadyCorpusJob(corpusBookId)) {
    count += 1;
    break;
  }
  return count;
}

function positiveInt(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}
