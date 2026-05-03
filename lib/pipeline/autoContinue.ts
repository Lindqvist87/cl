import type { PipelineJob } from "@prisma/client";
import type {
  PipelineBlockingJob,
  RunReadyJobsReason
} from "@/lib/pipeline/jobRunReasons";
import {
  canAttemptJob,
  dependencyIdsFromJson,
  isLockStale,
  PIPELINE_JOB_STATUS
} from "@/lib/pipeline/jobRules";
import {
  runReadyPipelineJobs,
  type RunPipelineJobResult,
  type RunReadyJobsOptions,
  type RunReadyJobsState,
  type RunReadyPipelineJobsResult
} from "@/lib/pipeline/pipelineJobs";
import {
  FULL_MANUSCRIPT_PIPELINE_STEPS,
  normalizeCheckpoint,
  type ManuscriptPipelineStep
} from "@/lib/pipeline/steps";
import { prisma } from "@/lib/prisma";

const DEFAULT_MAX_BATCHES = 5;
const DEFAULT_MAX_SECONDS = 240;
const DEFAULT_MAX_JOBS_PER_BATCH = 5;
const DEFAULT_MAX_ITEMS_PER_STEP = 4;

const ACTIVE_MANUSCRIPT_AUTO_RUNS = new Set<string>();
const ACTIVE_JOB_STATUSES = new Set<string>([
  PIPELINE_JOB_STATUS.QUEUED,
  PIPELINE_JOB_STATUS.RUNNING,
  PIPELINE_JOB_STATUS.RETRYING,
  PIPELINE_JOB_STATUS.BLOCKED
]);

export type AutoContinueStoppedReason =
  | "done"
  | "blocked_by_error"
  | "active_running_lock"
  | "no_ready_jobs"
  | "max_batches_reached"
  | "max_seconds_reached"
  | "recovered_stale_job_needs_next_run";

export type AutoContinueOptions = {
  manuscriptId: string;
  maxBatches?: number;
  maxSeconds?: number;
  maxJobsPerBatch?: number;
  maxItemsPerStep?: number;
  workerType?: NonNullable<RunReadyJobsOptions["workerType"]>;
  workerId?: string;
};

export type PipelineJobSummary = {
  id: string;
  type: string;
  status: string;
  error: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  lockExpiresAt: string | null;
  stale: boolean;
};

export type AutoContinueSnapshot = {
  finalState: RunReadyJobsState;
  lastStep: string | null;
  remainingJobs: PipelineJobSummary[];
  failedJobs: PipelineJobSummary[];
  activeRunningJobs: PipelineJobSummary[];
  nextEligibleJob: PipelineJobSummary | null;
};

export type AutoContinueBatchSummary = {
  batchNumber: number;
  jobsRun: number;
  state: RunReadyJobsState;
  reason: RunReadyJobsReason | null;
  message: string | null;
  remainingReadyJobs: number;
  unfinishedJobs: number;
  failedJobs: number;
  recoveredStaleJobs: PipelineBlockingJob[];
  results: RunPipelineJobResult[];
};

export type AutoContinueResult = AutoContinueSnapshot & {
  manuscriptId: string;
  batchesRun: number;
  totalJobsRun: number;
  stoppedReason: AutoContinueStoppedReason;
  messages: string[];
  batchSummaries: AutoContinueBatchSummary[];
  moreWorkRemains: boolean;
  hasRemainingWork: boolean;
  message: string;
  blockingJob: PipelineBlockingJob | null;
  recoveredStaleJobs: PipelineBlockingJob[];
};

export type AutoContinueDependencies = {
  runReadyJobs?: typeof runReadyPipelineJobs;
  getSnapshot?: typeof getManuscriptAutoContinueSnapshot;
  nowMs?: () => number;
};

export async function autoContinueManuscriptPipeline(
  options: AutoContinueOptions,
  dependencies: AutoContinueDependencies = {}
): Promise<AutoContinueResult> {
  const manuscriptId = options.manuscriptId;
  const releaseRunSlot = acquireManuscriptAutoRunSlot(manuscriptId);
  const getSnapshot =
    dependencies.getSnapshot ?? getManuscriptAutoContinueSnapshot;

  if (!releaseRunSlot) {
    const snapshot = await getSnapshot(manuscriptId);

    return buildAutoContinueResult({
      manuscriptId,
      snapshot,
      batchSummaries: [],
      stoppedReason: "active_running_lock",
      blockingJob: null
    });
  }

  const runReadyJobs = dependencies.runReadyJobs ?? runReadyPipelineJobs;
  const nowMs = dependencies.nowMs ?? Date.now;
  const maxBatches = positiveInt(options.maxBatches, DEFAULT_MAX_BATCHES);
  const maxSeconds = positiveInt(options.maxSeconds, DEFAULT_MAX_SECONDS);
  const maxJobsPerBatch = positiveInt(
    options.maxJobsPerBatch,
    DEFAULT_MAX_JOBS_PER_BATCH
  );
  const maxItemsPerStep = positiveInt(
    options.maxItemsPerStep,
    DEFAULT_MAX_ITEMS_PER_STEP
  );
  const workerType = options.workerType ?? "MANUAL";
  const workerId = options.workerId ?? `manual:auto-continue:${manuscriptId}`;
  const deadline = nowMs() + maxSeconds * 1000;
  const batchSummaries: AutoContinueBatchSummary[] = [];
  let stoppedReason: AutoContinueStoppedReason | null = null;
  let blockingJob: PipelineBlockingJob | null = null;

  try {
    while (batchSummaries.length < maxBatches) {
      const remainingMs = deadline - nowMs();
      if (remainingMs <= 0) {
        stoppedReason = "max_seconds_reached";
        break;
      }

      const batch = await runReadyJobs({
        manuscriptId,
        maxJobs: maxJobsPerBatch,
        maxSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
        maxItemsPerStep,
        workerType,
        workerId
      });
      const summary = batchSummary(batchSummaries.length + 1, batch);
      batchSummaries.push(summary);

      if (batch.blockingJob) {
        blockingJob = batch.blockingJob;
      }

      stoppedReason = stoppedReasonFromBatch(batch);
      if (stoppedReason) {
        break;
      }

      if (nowMs() >= deadline) {
        stoppedReason = "max_seconds_reached";
        break;
      }
    }

    const snapshot = await getSnapshot(manuscriptId);
    const finalStoppedReason =
      stoppedReason ??
      stoppedReasonAfterBudget({
        batchSummaries,
        maxBatches,
        snapshot
      });

    return buildAutoContinueResult({
      manuscriptId,
      snapshot,
      batchSummaries,
      stoppedReason: finalStoppedReason,
      blockingJob
    });
  } finally {
    releaseRunSlot();
  }
}

export async function getManuscriptAutoContinueSnapshot(
  manuscriptId: string
): Promise<AutoContinueSnapshot> {
  const now = new Date();
  const [run, jobs] = await Promise.all([
    prisma.analysisRun.findFirst({
      where: { manuscriptId },
      orderBy: { createdAt: "desc" },
      select: { checkpoint: true }
    }),
    prisma.pipelineJob.findMany({
      where: { manuscriptId },
      orderBy: [{ createdAt: "asc" }]
    })
  ]);
  const checkpoint = normalizeCheckpoint(run?.checkpoint);
  const summaries = jobs.map((job) => jobSummary(job, now));
  const remainingJobs = summaries.filter((job) =>
    ACTIVE_JOB_STATUSES.has(job.status)
  );
  const failedJobs = summaries.filter(
    (job) => job.status === PIPELINE_JOB_STATUS.FAILED
  );
  const activeRunningJobs = summaries.filter(
    (job) => job.status === PIPELINE_JOB_STATUS.RUNNING && !job.stale
  );
  const nextEligibleJob =
    jobs
      .map((job, index) => ({ job, summary: summaries[index] }))
      .find(({ job }) => isEligibleJob(job, jobs, now))?.summary ?? null;

  return {
    finalState:
      failedJobs.length > 0
        ? "blocked_by_error"
        : remainingJobs.length > 0
          ? "more_work_remains"
          : "done",
    lastStep: lastStepFromCheckpoint(checkpoint),
    remainingJobs,
    failedJobs,
    activeRunningJobs,
    nextEligibleJob
  };
}

function acquireManuscriptAutoRunSlot(manuscriptId: string) {
  if (ACTIVE_MANUSCRIPT_AUTO_RUNS.has(manuscriptId)) {
    return null;
  }

  ACTIVE_MANUSCRIPT_AUTO_RUNS.add(manuscriptId);

  return () => {
    ACTIVE_MANUSCRIPT_AUTO_RUNS.delete(manuscriptId);
  };
}

function stoppedReasonFromBatch(
  batch: RunReadyPipelineJobsResult
): AutoContinueStoppedReason | null {
  if (
    (batch.recoveredStaleJobs.length > 0 ||
      batch.reason === "stale_running_job_recovered") &&
    batch.jobsRun === 0 &&
    batch.remainingReadyJobs > 0
  ) {
    return null;
  }

  if (
    batch.reason === "waiting_for_lock_expiry" ||
    batch.reason === "running_job_in_progress"
  ) {
    return "active_running_lock";
  }

  if (
    batch.state === "blocked_by_error" ||
    batch.failedJobs > 0 ||
    batch.results.some((result) => result.status === "failed")
  ) {
    return "blocked_by_error";
  }

  if (batch.state === "done" || !batch.hasRemainingWork) {
    return "done";
  }

  if (batch.jobsRun === 0) {
    return "no_ready_jobs";
  }

  return null;
}

function stoppedReasonAfterBudget(input: {
  batchSummaries: AutoContinueBatchSummary[];
  maxBatches: number;
  snapshot: AutoContinueSnapshot;
}): AutoContinueStoppedReason {
  if (input.snapshot.finalState === "done") {
    return "done";
  }

  if (input.snapshot.finalState === "blocked_by_error") {
    return "blocked_by_error";
  }

  if (input.snapshot.activeRunningJobs.length > 0) {
    return "active_running_lock";
  }

  if (
    input.batchSummaries.length >= input.maxBatches &&
    input.snapshot.finalState === "more_work_remains"
  ) {
    return "max_batches_reached";
  }

  return input.snapshot.nextEligibleJob ? "max_batches_reached" : "no_ready_jobs";
}

function buildAutoContinueResult(input: {
  manuscriptId: string;
  snapshot: AutoContinueSnapshot;
  batchSummaries: AutoContinueBatchSummary[];
  stoppedReason: AutoContinueStoppedReason;
  blockingJob: PipelineBlockingJob | null;
}): AutoContinueResult {
  const totalJobsRun = input.batchSummaries.reduce(
    (total, batch) => total + batch.jobsRun,
    0
  );
  const recoveredStaleJobs = input.batchSummaries.flatMap(
    (batch) => batch.recoveredStaleJobs
  );
  const messages = input.batchSummaries.map((batch) => batch.message ?? "");
  const blockingJob =
    input.blockingJob ??
    (input.snapshot.activeRunningJobs[0]
      ? pipelineBlockingJobFromSummary(input.snapshot.activeRunningJobs[0])
      : null);
  const moreWorkRemains = input.snapshot.finalState === "more_work_remains";
  const hasRemainingWork = input.snapshot.finalState !== "done";

  return {
    manuscriptId: input.manuscriptId,
    batchesRun: input.batchSummaries.length,
    totalJobsRun,
    finalState: input.snapshot.finalState,
    stoppedReason: input.stoppedReason,
    lastStep: input.snapshot.lastStep,
    remainingJobs: input.snapshot.remainingJobs,
    failedJobs: input.snapshot.failedJobs,
    activeRunningJobs: input.snapshot.activeRunningJobs,
    nextEligibleJob: input.snapshot.nextEligibleJob,
    messages,
    batchSummaries: input.batchSummaries,
    moreWorkRemains,
    hasRemainingWork,
    message: autoContinueMessage({
      stoppedReason: input.stoppedReason,
      batchesRun: input.batchSummaries.length,
      totalJobsRun,
      snapshot: input.snapshot,
      blockingJob,
      recoveredStaleJobs,
      lastBatchMessage:
        input.batchSummaries[input.batchSummaries.length - 1]?.message ?? null
    }),
    blockingJob,
    recoveredStaleJobs
  };
}

function batchSummary(
  batchNumber: number,
  batch: RunReadyPipelineJobsResult
): AutoContinueBatchSummary {
  return {
    batchNumber,
    jobsRun: batch.jobsRun,
    state: batch.state,
    reason: batch.reason ?? null,
    message: batch.message ?? defaultBatchMessage(batchNumber, batch),
    remainingReadyJobs: batch.remainingReadyJobs,
    unfinishedJobs: batch.unfinishedJobs,
    failedJobs: batch.failedJobs,
    recoveredStaleJobs: batch.recoveredStaleJobs,
    results: batch.results
  };
}

function defaultBatchMessage(
  batchNumber: number,
  batch: RunReadyPipelineJobsResult
) {
  if (batch.state === "done") {
    return `Batch ${batchNumber} ran ${batch.jobsRun} job(s); pipeline completed.`;
  }

  if (batch.state === "blocked_by_error") {
    return `Batch ${batchNumber} ran ${batch.jobsRun} job(s); pipeline is blocked by error.`;
  }

  return `Batch ${batchNumber} ran ${batch.jobsRun} job(s); more work remains.`;
}

function autoContinueMessage(input: {
  stoppedReason: AutoContinueStoppedReason;
  batchesRun: number;
  totalJobsRun: number;
  snapshot: AutoContinueSnapshot;
  blockingJob: PipelineBlockingJob | null;
  recoveredStaleJobs: PipelineBlockingJob[];
  lastBatchMessage: string | null;
}) {
  switch (input.stoppedReason) {
    case "done":
      return "Pipeline completed.";
    case "blocked_by_error": {
      const failed = input.snapshot.failedJobs[0];
      return failed
        ? `Pipeline stopped because ${failed.type} failed${
            failed.error ? `: ${failed.error}` : "."
          }`
        : "Pipeline stopped because a job failed.";
    }
    case "active_running_lock": {
      const jobType = input.blockingJob?.type ?? "a pipeline job";
      const lockExpiresAt = input.blockingJob?.lockExpiresAt;
      return `Paused because ${jobType} is locked until ${
        lockExpiresAt ?? "the active lock expires"
      }.`;
    }
    case "recovered_stale_job_needs_next_run": {
      const recovered = input.recoveredStaleJobs[0] ?? input.blockingJob;
      return recovered
        ? `Recovered stale ${recovered.type}. Run until pause again to continue.`
        : "Recovered a stale pipeline job. Run until pause again to continue.";
    }
    case "max_batches_reached":
      return `${runSummary(input.batchesRun, input.totalJobsRun)} More work remains.`;
    case "max_seconds_reached":
      return `${runSummary(input.batchesRun, input.totalJobsRun)} Time budget reached; more work may remain.`;
    case "no_ready_jobs":
      return (
        input.lastBatchMessage ??
        "Paused because no ready jobs can run right now. More work remains."
      );
  }
}

function runSummary(batchesRun: number, totalJobsRun: number) {
  return `Ran ${batchesRun} ${batchesRun === 1 ? "batch" : "batches"}, processed ${totalJobsRun} ${
    totalJobsRun === 1 ? "item" : "items"
  }.`;
}

function jobSummary(job: PipelineJob, now: Date): PipelineJobSummary {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    error: job.error,
    lockedBy: job.lockedBy,
    lockedAt: job.lockedAt?.toISOString() ?? null,
    lockExpiresAt: job.lockExpiresAt?.toISOString() ?? null,
    stale: isLockStale(job, now)
  };
}

function pipelineBlockingJobFromSummary(
  job: PipelineJobSummary
): PipelineBlockingJob {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    lockedBy: job.lockedBy,
    lockedAt: job.lockedAt,
    lockExpiresAt: job.lockExpiresAt,
    stale: job.stale
  };
}

function isEligibleJob(job: PipelineJob, allJobs: PipelineJob[], now: Date) {
  if (!canAttemptJob(job, now)) {
    return false;
  }

  if (
    job.status === PIPELINE_JOB_STATUS.RETRYING &&
    job.attempts >= job.maxAttempts
  ) {
    return false;
  }

  const completed = new Set(
    allJobs
      .filter((candidate) => candidate.status === PIPELINE_JOB_STATUS.COMPLETED)
      .map((candidate) => candidate.id)
  );

  return dependencyIdsFromJson(job.dependencyIds).every((id) =>
    completed.has(id)
  );
}

function lastStepFromCheckpoint(
  checkpoint: ReturnType<typeof normalizeCheckpoint>
) {
  const currentStep = stepOrNull(checkpoint.currentStep);
  if (currentStep) {
    return currentStep;
  }

  const completedSteps = checkpoint.completedSteps ?? [];
  for (let index = completedSteps.length - 1; index >= 0; index -= 1) {
    const step = stepOrNull(completedSteps[index]);
    if (step) {
      return step;
    }
  }

  return null;
}

function stepOrNull(value: unknown): ManuscriptPipelineStep | null {
  return typeof value === "string" &&
    FULL_MANUSCRIPT_PIPELINE_STEPS.includes(
      value as (typeof FULL_MANUSCRIPT_PIPELINE_STEPS)[number]
    )
    ? (value as ManuscriptPipelineStep)
    : null;
}

function positiveInt(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}
