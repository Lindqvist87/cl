import {
  FULL_MANUSCRIPT_PIPELINE_STEPS,
  normalizeCheckpoint,
  type ManuscriptPipelineStep
} from "@/lib/pipeline/steps";
import { PIPELINE_JOB_STATUS } from "@/lib/pipeline/jobRules";

export type PipelineDisplayJob = {
  type: string;
  status: string;
  result?: unknown;
  error?: string | null;
  updatedAt?: Date | string | null;
  completedAt?: Date | string | null;
  startedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

export type PipelineDisplayRun = {
  status?: string;
  checkpoint?: unknown;
  error?: string | null;
  updatedAt?: Date | string | null;
};

export type PipelineDisplayTotals = {
  chunks?: number | null;
};

export type PipelineJobCounts = {
  queued: number;
  running: number;
  blocked: number;
  failed: number;
  completed: number;
};

export type PipelineStatusDisplay = {
  currentStep: string | null;
  completedSteps: number;
  totalSteps: number;
  percent: number;
  currentJobStatus: string | null;
  analyzedCount: number | null;
  remainingCount: number | null;
  complete: boolean;
  lastUpdatedAt: string | null;
  lastError: string | null;
  nextBlockedStep: string | null;
  jobCounts: PipelineJobCounts;
  stepProgressLabel: string | null;
  remainingLabel: string | null;
};

const STEP_SET = new Set<string>(FULL_MANUSCRIPT_PIPELINE_STEPS);
const ACTIVE_JOB_STATUSES = new Set<string>([
  PIPELINE_JOB_STATUS.RUNNING,
  PIPELINE_JOB_STATUS.RETRYING,
  PIPELINE_JOB_STATUS.QUEUED,
  PIPELINE_JOB_STATUS.BLOCKED,
  PIPELINE_JOB_STATUS.FAILED
]);

export function buildPipelineStatusDisplay(input: {
  run?: PipelineDisplayRun | null;
  checkpoint?: unknown;
  jobs?: PipelineDisplayJob[];
  totals?: PipelineDisplayTotals;
}): PipelineStatusDisplay {
  const jobs = input.jobs ?? [];
  const checkpoint = normalizeCheckpoint(
    input.checkpoint ?? input.run?.checkpoint ?? {}
  );
  const completedStepSet = new Set(
    (checkpoint.completedSteps ?? []).filter((step) => STEP_SET.has(step))
  );
  const completedSteps = completedStepSet.size;
  const totalSteps = FULL_MANUSCRIPT_PIPELINE_STEPS.length;
  const orderedJobs = sortPipelineJobs(jobs);
  const activeJob = orderedJobs.find(
    (job) => isPipelineStep(job.type) && ACTIVE_JOB_STATUSES.has(job.status)
  );
  const currentStep =
    (isPipelineStep(checkpoint.currentStep) ? checkpoint.currentStep : null) ??
    (activeJob && isPipelineStep(activeJob.type) ? activeJob.type : null) ??
    FULL_MANUSCRIPT_PIPELINE_STEPS.find((step) => !completedStepSet.has(step)) ??
    null;
  const currentJob =
    currentStep ? orderedJobs.find((job) => job.type === currentStep) : undefined;
  const progressRecord = currentStep
    ? {
        ...recordForStep(checkpoint.stepMetadata, currentStep),
        ...recordFromUnknown(currentJob?.result)
      }
    : {};
  const remainingCount = numberValue(progressRecord.remaining);
  const stepTotal = totalForStep(currentStep, progressRecord, input.totals);
  const analyzedCount = analyzedForStep(currentStep, progressRecord, {
    remaining: remainingCount,
    total: stepTotal
  });
  const complete =
    booleanValue(progressRecord.complete) ??
    (completedSteps === totalSteps && totalSteps > 0) ??
    false;
  const nextBlockedStep =
    orderedJobs.find(
      (job) => isPipelineStep(job.type) && job.status === PIPELINE_JOB_STATUS.BLOCKED
    )?.type ?? null;
  const stepProgressLabel = progressLabelForStep(currentStep, {
    analyzed: analyzedCount,
    total: stepTotal,
    remaining: remainingCount
  });

  return {
    currentStep,
    completedSteps,
    totalSteps,
    percent: Math.round((completedSteps / totalSteps) * 100),
    currentJobStatus: currentJob?.status ?? input.run?.status ?? null,
    analyzedCount,
    remainingCount,
    complete,
    lastUpdatedAt: latestDateIso([
      progressRecord.updatedAt,
      progressRecord.completedAt,
      currentJob?.updatedAt,
      currentJob?.completedAt,
      currentJob?.startedAt,
      currentJob?.createdAt,
      input.run?.updatedAt
    ]),
    lastError:
      currentJob?.error ??
      latestErroredJob(orderedJobs)?.error ??
      input.run?.error ??
      null,
    nextBlockedStep,
    jobCounts: countPipelineJobsByStatus(jobs),
    stepProgressLabel,
    remainingLabel:
      typeof remainingCount === "number" ? `${remainingCount} remaining` : null
  };
}

export function countPipelineJobsByStatus(jobs: Array<{ status: string }>): PipelineJobCounts {
  const queuedStatuses = new Set<string>([
    PIPELINE_JOB_STATUS.QUEUED,
    PIPELINE_JOB_STATUS.RETRYING
  ]);

  return {
    queued: jobs.filter((job) => queuedStatuses.has(job.status)).length,
    running: jobs.filter((job) => job.status === PIPELINE_JOB_STATUS.RUNNING).length,
    blocked: jobs.filter((job) => job.status === PIPELINE_JOB_STATUS.BLOCKED).length,
    failed: jobs.filter((job) => job.status === PIPELINE_JOB_STATUS.FAILED).length,
    completed: jobs.filter((job) => job.status === PIPELINE_JOB_STATUS.COMPLETED).length
  };
}

function sortPipelineJobs(jobs: PipelineDisplayJob[]) {
  return [...jobs].sort((a, b) => {
    const orderA = stepOrder(a.type);
    const orderB = stepOrder(b.type);
    if (orderA !== orderB) {
      return orderA - orderB;
    }

    return dateMs(a.createdAt) - dateMs(b.createdAt);
  });
}

function stepOrder(type: string) {
  const index = FULL_MANUSCRIPT_PIPELINE_STEPS.indexOf(
    type as ManuscriptPipelineStep
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function isPipelineStep(value: unknown): value is ManuscriptPipelineStep {
  return typeof value === "string" && STEP_SET.has(value);
}

function recordForStep(value: unknown, step: ManuscriptPipelineStep) {
  return recordFromUnknown(recordFromUnknown(value)[step]);
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function totalForStep(
  step: string | null,
  record: Record<string, unknown>,
  totals?: PipelineDisplayTotals
) {
  if (step === "summarizeChunks" && typeof totals?.chunks === "number") {
    return Math.max(0, totals.chunks);
  }

  return firstNumber(record.total, record.totalCount, record.chunkCount);
}

function analyzedForStep(
  step: string | null,
  record: Record<string, unknown>,
  counts: { remaining: number | null; total: number | null }
) {
  if (
    step === "summarizeChunks" &&
    typeof counts.total === "number" &&
    typeof counts.remaining === "number"
  ) {
    return Math.max(0, counts.total - counts.remaining);
  }

  return firstNumber(
    record.analyzed,
    record.audited,
    record.drafted,
    record.summarized,
    record.stored
  );
}

function progressLabelForStep(
  step: string | null,
  counts: { analyzed: number | null; total: number | null; remaining: number | null }
) {
  if (
    step === "summarizeChunks" &&
    typeof counts.analyzed === "number" &&
    typeof counts.total === "number"
  ) {
    return `${counts.analyzed} / ${counts.total} chunks summarized`;
  }

  return null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const numeric = numberValue(value);
    if (numeric !== null) {
      return numeric;
    }
  }

  return null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function latestErroredJob(jobs: PipelineDisplayJob[]) {
  return [...jobs]
    .filter((job) => job.error)
    .sort((a, b) => dateMs(b.updatedAt) - dateMs(a.updatedAt))[0];
}

function latestDateIso(values: unknown[]) {
  const latest = values
    .map(dateMs)
    .filter((value) => value > 0)
    .sort((a, b) => b - a)[0];

  return latest ? new Date(latest).toISOString() : null;
}

function dateMs(value: unknown) {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}
