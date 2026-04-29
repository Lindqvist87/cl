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
  CHAPTER_REWRITE: "CHAPTER_REWRITE"
} as const;

export type JobRuleSnapshot = {
  status: string;
  dependencyIds?: unknown;
  lockedAt?: Date | string | null;
  lockExpiresAt?: Date | string | null;
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
  return Boolean(job.lockExpiresAt && new Date(job.lockExpiresAt) <= now);
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
