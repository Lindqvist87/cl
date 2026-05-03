import {
  CORE_MANUSCRIPT_PIPELINE_STEPS,
  MANUSCRIPT_PIPELINE_STEPS,
  isCoreManuscriptPipelineStep,
  isManuscriptPipelineStep,
  isOptionalManuscriptPipelineStep,
  normalizeCheckpoint,
  type ManuscriptPipelineStep
} from "@/lib/pipeline/steps";
import { PIPELINE_JOB_STATUS } from "@/lib/pipeline/jobRules";

export type PipelineDisplayJob = {
  type: string;
  status: string;
  result?: unknown;
  error?: string | null;
  lockedBy?: string | null;
  lockedAt?: Date | string | null;
  lockExpiresAt?: Date | string | null;
  stale?: boolean;
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
  summarizedChunks?: number | null;
  chapters?: number | null;
  sections?: number | null;
  auditTargets?: number | null;
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
  nextStep: string | null;
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
  stepProgress: PipelineStepProgressDisplay | null;
  lockStatus: PipelineLockStatusDisplay | null;
  coreAnalysisComplete: boolean;
  optionalRewriteDraftsPending: boolean;
};

export type PipelineStepProgressDisplay = {
  step: string;
  completed: number | null;
  total: number | null;
  remaining: number | null;
  percent: number | null;
  label: string | null;
  remainingLabel: string | null;
};

export type PipelineLockStatusDisplay = {
  type: string;
  status: string;
  lockedBy: string | null;
  lockedAt: string | null;
  lockExpiresAt: string | null;
  stale: boolean;
  message: string;
};

export type PipelineDiagnosticsPollingSnapshot = {
  state?: string | null;
  remainingJobCount?: number | null;
  nextEligibleJob?: unknown;
  activeRunningJobs?: unknown[] | null;
  staleRunningJobs?: unknown[] | null;
  manualRunner?: {
    reason?: string | null;
    message?: string | null;
    blockingJob?: unknown;
  } | null;
  run?: {
    status?: string | null;
    error?: string | null;
  } | null;
  pipelineStatus?: {
    complete?: boolean | null;
    currentJobStatus?: string | null;
    lastError?: string | null;
  } | null;
};

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
  const orderedJobs = sortPipelineJobs(jobs);
  const rawCompletedCoreStepSet = new Set(
    (checkpoint.completedSteps ?? []).filter(isCoreManuscriptPipelineStep)
  );
  const forceSummarizeChunks = shouldForceSummarizeChunks(input.totals);
  const completedCoreStepSet = forceSummarizeChunks
    ? pruneCompletedStepsFrom(rawCompletedCoreStepSet, "summarizeChunks")
    : rawCompletedCoreStepSet;
  const completedSteps = completedCoreStepSet.size;
  const totalSteps = CORE_MANUSCRIPT_PIPELINE_STEPS.length;
  const activeJob = orderedJobs.find(
    (job) =>
      isCoreManuscriptPipelineStep(job.type) && ACTIVE_JOB_STATUSES.has(job.status)
  );
  const optionalRewriteDraftJob = orderedJobs.find(
    (job) =>
      isOptionalManuscriptPipelineStep(job.type) &&
      ACTIVE_JOB_STATUSES.has(job.status)
  );
  const currentStep =
    (forceSummarizeChunks
      ? "summarizeChunks"
      : null) ??
    (isCoreManuscriptPipelineStep(checkpoint.currentStep)
      ? checkpoint.currentStep
      : null) ??
    (activeJob && isCoreManuscriptPipelineStep(activeJob.type)
      ? activeJob.type
      : null) ??
    CORE_MANUSCRIPT_PIPELINE_STEPS.find((step) => !completedCoreStepSet.has(step)) ??
    null;
  const currentJob =
    currentStep ? orderedJobs.find((job) => job.type === currentStep) : undefined;
  const progressRecord = currentStep
    ? {
        ...recordForStep(checkpoint.stepMetadata, currentStep),
        ...recordFromUnknown(currentJob?.result)
      }
    : {};
  const stepTotal = totalForStep(currentStep, progressRecord, input.totals);
  const measuredProgress = measuredProgressForStep(
    currentStep,
    stepTotal,
    input.totals
  );
  const remainingCount =
    measuredProgress?.remaining ?? numberValue(progressRecord.remaining);
  const analyzedCount =
    measuredProgress?.analyzed ??
    analyzedForStep(currentStep, progressRecord, {
      remaining: remainingCount,
      total: stepTotal
    });
  const nextStep = nextStepFor(currentStep, completedCoreStepSet);
  const coreAnalysisComplete = completedSteps === totalSteps && totalSteps > 0;
  const optionalRewriteDraftsPending = Boolean(optionalRewriteDraftJob);
  const complete =
    (measuredProgress && typeof remainingCount === "number"
      ? remainingCount === 0
      : null) ??
    booleanValue(progressRecord.complete) ??
    coreAnalysisComplete ??
    false;
  const nextBlockedStep =
    orderedJobs.find(
      (job) =>
        isCoreManuscriptPipelineStep(job.type) &&
        job.status === PIPELINE_JOB_STATUS.BLOCKED
    )?.type ?? null;
  const stepProgressLabel = progressLabelForStep(currentStep, {
    analyzed: analyzedCount,
    total: stepTotal,
    remaining: remainingCount
  });
  const remainingLabel =
    typeof remainingCount === "number" ? `${remainingCount} remaining` : null;
  const stepProgress = stepProgressForStep(currentStep, {
    analyzed: analyzedCount,
    total: stepTotal,
    remaining: remainingCount,
    label: stepProgressLabel,
    remainingLabel
  });

  return {
    currentStep,
    nextStep,
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
    remainingLabel,
    stepProgress,
    lockStatus: buildPipelineLockStatus(
      (currentJob?.status === PIPELINE_JOB_STATUS.RUNNING ? currentJob : null) ??
        orderedJobs.find(
          (job) =>
            isManuscriptPipelineStep(job.type) &&
            job.status === PIPELINE_JOB_STATUS.RUNNING
        ) ??
        null
    ),
    coreAnalysisComplete,
    optionalRewriteDraftsPending
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

export function buildPipelineLockStatus(
  job?: PipelineDisplayJob | null
): PipelineLockStatusDisplay | null {
  if (!job || job.status !== PIPELINE_JOB_STATUS.RUNNING) {
    return null;
  }

  const stale =
    typeof job.stale === "boolean"
      ? job.stale
      : Boolean(job.lockExpiresAt && dateMs(job.lockExpiresAt) <= Date.now());
  const lockedAt = isoDate(job.lockedAt);
  const lockExpiresAt = isoDate(job.lockExpiresAt);

  return {
    type: job.type,
    status: job.status,
    lockedBy: job.lockedBy ?? null,
    lockedAt,
    lockExpiresAt,
    stale,
    message: lockMessage({
      type: job.type,
      lockedBy: job.lockedBy ?? null,
      lockExpiresAt,
      stale
    })
  };
}

export function shouldPollPipelineDiagnostics(
  diagnostics: PipelineDiagnosticsPollingSnapshot
) {
  const runStatus = diagnostics.run?.status?.toUpperCase() ?? null;
  const jobStatus =
    diagnostics.pipelineStatus?.currentJobStatus?.toUpperCase() ?? null;
  const state = diagnostics.state ?? null;

  if (
    runStatus === "FAILED" ||
    jobStatus === PIPELINE_JOB_STATUS.FAILED ||
    state === "blocked_by_error"
  ) {
    return false;
  }

  if (diagnostics.pipelineStatus?.complete || state === "done") {
    return false;
  }

  if (
    state === "more_work_remains" ||
    diagnostics.nextEligibleJob ||
    (diagnostics.remainingJobCount ?? 0) > 0 ||
    (diagnostics.activeRunningJobs?.length ?? 0) > 0 ||
    (diagnostics.staleRunningJobs?.length ?? 0) > 0
  ) {
    return true;
  }

  return new Set<string>([
    PIPELINE_JOB_STATUS.QUEUED,
    PIPELINE_JOB_STATUS.RUNNING,
    PIPELINE_JOB_STATUS.RETRYING,
    PIPELINE_JOB_STATUS.BLOCKED
  ]).has(jobStatus ?? "");
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

function shouldForceSummarizeChunks(totals?: PipelineDisplayTotals) {
  const total = totals?.chunks;
  const summarized = totals?.summarizedChunks;
  return (
    typeof total === "number" &&
    typeof summarized === "number" &&
    total > 0 &&
    summarized < total
  );
}

function pruneCompletedStepsFrom(
  completedStepSet: Set<string>,
  firstIncompleteStep: ManuscriptPipelineStep
) {
  const firstIncompleteIndex = CORE_MANUSCRIPT_PIPELINE_STEPS.indexOf(
    firstIncompleteStep as (typeof CORE_MANUSCRIPT_PIPELINE_STEPS)[number]
  );
  const pruned = new Set<string>();

  for (const step of completedStepSet) {
    const index = CORE_MANUSCRIPT_PIPELINE_STEPS.indexOf(
      step as (typeof CORE_MANUSCRIPT_PIPELINE_STEPS)[number]
    );
    if (index >= 0 && index < firstIncompleteIndex) {
      pruned.add(step);
    }
  }

  return pruned;
}

function stepOrder(type: string) {
  const index = MANUSCRIPT_PIPELINE_STEPS.indexOf(
    type as ManuscriptPipelineStep
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
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

  if (step === "runChapterAudits") {
    return firstNumber(
      record.total,
      record.totalCount,
      record.auditTargets,
      record.auditTargetCount,
      record.sectionCount,
      record.sections,
      record.chapterCount,
      record.chapters,
      totals?.auditTargets,
      totals?.sections,
      totals?.chapters
    );
  }

  return firstNumber(record.total, record.totalCount, record.chunkCount);
}

function measuredProgressForStep(
  step: string | null,
  total: number | null,
  totals?: PipelineDisplayTotals
) {
  if (
    step !== "summarizeChunks" ||
    typeof totals?.summarizedChunks !== "number"
  ) {
    return null;
  }

  const analyzed = Math.max(0, Math.floor(totals.summarizedChunks));
  const clampedAnalyzed =
    typeof total === "number" ? Math.min(total, analyzed) : analyzed;

  return {
    analyzed: clampedAnalyzed,
    remaining:
      typeof total === "number" ? Math.max(total - clampedAnalyzed, 0) : null
  };
}

function analyzedForStep(
  step: string | null,
  record: Record<string, unknown>,
  counts: { remaining: number | null; total: number | null }
) {
  if (
    (step === "summarizeChunks" || step === "runChapterAudits") &&
    typeof counts.total === "number" &&
    typeof counts.remaining === "number"
  ) {
    return Math.max(0, counts.total - counts.remaining);
  }

  if (step === "runChapterAudits") {
    return null;
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

  if (
    step === "runChapterAudits" &&
    typeof counts.analyzed === "number" &&
    typeof counts.total === "number"
  ) {
    return `${counts.analyzed} / ${counts.total} section audits completed`;
  }

  return null;
}

function stepProgressForStep(
  step: string | null,
  progress: {
    analyzed: number | null;
    total: number | null;
    remaining: number | null;
    label: string | null;
    remainingLabel: string | null;
  }
): PipelineStepProgressDisplay | null {
  if (step !== "summarizeChunks" && step !== "runChapterAudits") {
    return null;
  }

  if (
    typeof progress.analyzed !== "number" &&
    typeof progress.total !== "number" &&
    typeof progress.remaining !== "number"
  ) {
    return null;
  }

  return {
    step,
    completed: progress.analyzed,
    total: progress.total,
    remaining: progress.remaining,
    percent:
      typeof progress.analyzed === "number" &&
      typeof progress.total === "number" &&
      progress.total > 0
        ? Math.round((progress.analyzed / progress.total) * 100)
        : null,
    label: progress.label,
    remainingLabel: progress.remainingLabel
  };
}

function nextStepFor(
  currentStep: string | null,
  completedStepSet: Set<string>
) {
  if (currentStep) {
    const index = CORE_MANUSCRIPT_PIPELINE_STEPS.indexOf(
      currentStep as (typeof CORE_MANUSCRIPT_PIPELINE_STEPS)[number]
    );

    return index >= 0 ? CORE_MANUSCRIPT_PIPELINE_STEPS[index + 1] ?? null : null;
  }

  return CORE_MANUSCRIPT_PIPELINE_STEPS.find(
    (step) => !completedStepSet.has(step)
  ) ?? null;
}

function lockMessage(input: {
  type: string;
  lockedBy: string | null;
  lockExpiresAt: string | null;
  stale: boolean;
}) {
  if (input.stale) {
    return "Lock expired. Click Run next batch to recover and continue.";
  }

  const lockedBy = input.lockedBy ? ` by ${input.lockedBy}` : "";
  const lockedUntil = input.lockExpiresAt
    ? ` until ${formatTimeOfDay(input.lockExpiresAt)}`
    : "";

  return `${input.type} is running and locked${lockedBy}${lockedUntil}. Wait for the current batch to finish.`;
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

function isoDate(value: unknown) {
  const ms = dateMs(value);

  return ms ? new Date(ms).toISOString() : null;
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

function formatTimeOfDay(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
