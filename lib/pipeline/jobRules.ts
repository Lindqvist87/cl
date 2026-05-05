export const PIPELINE_JOB_STATUS = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  RETRYING: "RETRYING",
  BLOCKED: "BLOCKED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED"
} as const;

export type PipelineJobStatus =
  (typeof PIPELINE_JOB_STATUS)[keyof typeof PIPELINE_JOB_STATUS];

export const PIPELINE_JOB_TYPES = {
  CHAPTER_REWRITE: "CHAPTER_REWRITE",
  CORPUS_CLEAN: "CORPUS_CLEAN",
  CORPUS_CHAPTERS: "CORPUS_CHAPTERS",
  CORPUS_CHUNK: "CORPUS_CHUNK",
  CORPUS_EMBED: "CORPUS_EMBED",
  CORPUS_PROFILE: "CORPUS_PROFILE",
  CORPUS_BENCHMARK_CHECK: "CORPUS_BENCHMARK_CHECK"
} as const;

export const DEFAULT_STALE_RUNNING_JOB_MS = 10 * 60 * 1000;
export const MANUAL_FINAL_SYNTHESIS_LOCK_MS = 2 * 60 * 1000;

const FINAL_SYNTHESIS_JOB_TYPES = new Set<string>([
  "runWholeBookAudit",
  "compareAgainstCorpus",
  "compareAgainstTrendSignals",
  "createRewritePlan"
]);

export type JobRuleSnapshot = {
  type?: string;
  status: string;
  dependencyIds?: unknown;
  lockedBy?: string | null;
  lockedAt?: Date | string | null;
  lockExpiresAt?: Date | string | null;
  startedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  readyAt?: Date | string | null;
  attempts?: number;
  maxAttempts?: number;
};

export type DependencySnapshot = {
  id: string;
  status: string;
};

export function dependencyIdsFromJson(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export function areDependenciesComplete(
  dependencyIds: string[],
  dependencies: DependencySnapshot[]
) {
  const completed = new Set(
    dependencies
      .filter((dependency) => dependency.status === PIPELINE_JOB_STATUS.COMPLETED)
      .map((dependency) => dependency.id)
  );

  return dependencyIds.every((id) => completed.has(id));
}

export function isTerminalJobStatus(status: string) {
  return new Set<string>([
    PIPELINE_JOB_STATUS.COMPLETED,
    PIPELINE_JOB_STATUS.FAILED,
    PIPELINE_JOB_STATUS.CANCELLED
  ]).has(status);
}

export function isJobCancelled(job: JobRuleSnapshot) {
  return job.status === PIPELINE_JOB_STATUS.CANCELLED;
}

export function isCompletedJob(job: JobRuleSnapshot) {
  return job.status === PIPELINE_JOB_STATUS.COMPLETED;
}

export function isJobReadyAtSatisfied(
  job: JobRuleSnapshot,
  now: Date = new Date()
) {
  return !job.readyAt || new Date(job.readyAt) <= now;
}

export function isLockStale(job: JobRuleSnapshot, now: Date = new Date()) {
  const referenceTime = firstDateMs(job.lockedAt, job.startedAt, job.updatedAt);

  if (
    isManualFinalSynthesisJob(job) &&
    referenceTime !== null &&
    referenceTime <= now.getTime() - MANUAL_FINAL_SYNTHESIS_LOCK_MS
  ) {
    return true;
  }

  if (job.lockExpiresAt && new Date(job.lockExpiresAt) <= now) {
    return true;
  }

  if (job.status !== PIPELINE_JOB_STATUS.RUNNING || job.lockExpiresAt) {
    return false;
  }

  return (
    referenceTime !== null &&
    referenceTime <= now.getTime() - DEFAULT_STALE_RUNNING_JOB_MS
  );
}

export function isFinalSynthesisJobType(type: unknown) {
  return typeof type === "string" && FINAL_SYNTHESIS_JOB_TYPES.has(type);
}

export function canAttemptJob(job: JobRuleSnapshot, now: Date = new Date()) {
  const attemptableStatuses = new Set<string>([
    PIPELINE_JOB_STATUS.QUEUED,
    PIPELINE_JOB_STATUS.RETRYING,
    PIPELINE_JOB_STATUS.BLOCKED
  ]);

  if (!attemptableStatuses.has(job.status)) {
    return false;
  }

  if (!isJobReadyAtSatisfied(job, now)) {
    return false;
  }

  return !job.lockedAt || isLockStale(job, now);
}

export function nextStatusAfterJobError(input: {
  attempts: number;
  maxAttempts: number;
}) {
  return input.attempts >= input.maxAttempts
    ? PIPELINE_JOB_STATUS.FAILED
    : PIPELINE_JOB_STATUS.RETRYING;
}

export function executionModeLabel(input: {
  inngestEnabled: boolean;
  hasCronFallback?: boolean;
}) {
  if (input.inngestEnabled) {
    return "Inngest worker enabled";
  }

  return input.hasCronFallback ? "Vercel cron fallback" : "Manual/request runner";
}

function firstDateMs(...values: Array<Date | string | null | undefined>) {
  for (const value of values) {
    if (!value) {
      continue;
    }

    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (Number.isFinite(time)) {
      return time;
    }
  }

  return null;
}

function isManualFinalSynthesisJob(job: JobRuleSnapshot) {
  return (
    job.status === PIPELINE_JOB_STATUS.RUNNING &&
    isFinalSynthesisJobType(job.type) &&
    typeof job.lockedBy === "string" &&
    job.lockedBy.startsWith("manual:")
  );
}
