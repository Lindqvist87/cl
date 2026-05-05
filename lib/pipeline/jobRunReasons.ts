import type { PipelineJob } from "@prisma/client";
import { isLockStale, PIPELINE_JOB_STATUS } from "@/lib/pipeline/jobRules";

export type RunReadyJobsReason =
  | "running_job_in_progress"
  | "waiting_for_lock_expiry"
  | "stale_running_job_recovered"
  | "blocked_by_error"
  | "no_ready_jobs_but_unfinished_work";

export type PipelineBlockingJob = {
  id: string;
  type: string;
  status: string;
  lockedBy: string | null;
  lockedAt: string | null;
  lockExpiresAt: string | null;
  stale: boolean;
};

type JobForRunReason = Pick<
  PipelineJob,
  | "id"
  | "type"
  | "status"
  | "lockedBy"
  | "lockedAt"
  | "lockExpiresAt"
  | "startedAt"
  | "updatedAt"
>;

export type RunReadyJobsReasonInput = {
  state: "done" | "more_work_remains" | "blocked_by_error";
  jobs: JobForRunReason[];
  staleRecoveredJobs?: PipelineBlockingJob[];
  now?: Date;
};

export type RunReadyJobsReasonResult = {
  reason?: RunReadyJobsReason;
  blockingJob?: PipelineBlockingJob;
  message?: string;
};

export function pipelineBlockingJob(
  job: JobForRunReason,
  now: Date = new Date()
): PipelineBlockingJob {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    lockedBy: job.lockedBy,
    lockedAt: job.lockedAt?.toISOString() ?? null,
    lockExpiresAt: job.lockExpiresAt?.toISOString() ?? null,
    stale: isLockStale(job, now)
  };
}

export function zeroRunReasonForJobs(
  input: RunReadyJobsReasonInput
): RunReadyJobsReasonResult {
  const now = input.now ?? new Date();
  const recovered = input.staleRecoveredJobs?.[0];

  if (recovered) {
    return runReasonResult("stale_running_job_recovered", recovered);
  }

  if (input.state === "done") {
    return {};
  }

  if (input.state === "blocked_by_error") {
    const failed = input.jobs.find(
      (job) => job.status === PIPELINE_JOB_STATUS.FAILED
    );

    return runReasonResult(
      "blocked_by_error",
      failed ? pipelineBlockingJob(failed, now) : undefined
    );
  }

  const activeRunning = input.jobs.find(
    (job) =>
      job.status === PIPELINE_JOB_STATUS.RUNNING && !isLockStale(job, now)
  );

  if (activeRunning) {
    const reason = activeRunning.lockExpiresAt
      ? "waiting_for_lock_expiry"
      : "running_job_in_progress";

    return runReasonResult(reason, pipelineBlockingJob(activeRunning, now));
  }

  const staleRunning = input.jobs.find(
    (job) => job.status === PIPELINE_JOB_STATUS.RUNNING && isLockStale(job, now)
  );

  if (staleRunning) {
    return runReasonResult(
      "stale_running_job_recovered",
      pipelineBlockingJob(staleRunning, now)
    );
  }

  const unfinished = input.jobs.find((job) =>
    new Set<string>([
      PIPELINE_JOB_STATUS.QUEUED,
      PIPELINE_JOB_STATUS.RUNNING,
      PIPELINE_JOB_STATUS.RETRYING,
      PIPELINE_JOB_STATUS.BLOCKED
    ]).has(job.status)
  );

  return runReasonResult(
    "no_ready_jobs_but_unfinished_work",
    unfinished ? pipelineBlockingJob(unfinished, now) : undefined
  );
}

export function runReadyJobsReasonMessage(
  reason: RunReadyJobsReason,
  blockingJob?: PipelineBlockingJob
) {
  const jobType = blockingJob?.type ?? "a pipeline job";

  switch (reason) {
    case "waiting_for_lock_expiry":
      return `0 jobs ran because ${jobType} is currently marked running and locked until ${
        blockingJob?.lockExpiresAt ?? "the lock expires"
      }. If no progress occurs, it will be recovered after the lock expires.`;
    case "running_job_in_progress":
      return `0 jobs ran because ${jobType} is currently marked running${
        blockingJob?.lockedBy ? ` by ${blockingJob.lockedBy}` : ""
      }.`;
    case "stale_running_job_recovered":
      return `Recovered stale running job ${jobType}. Run again to continue.`;
    case "blocked_by_error":
      return `0 jobs ran because ${jobType} is blocked by an error. Review or retry the failed job.`;
    case "no_ready_jobs_but_unfinished_work":
      return `0 jobs ran because unfinished work remains but no job is currently ready to run${
        blockingJob ? `; ${blockingJob.type} is ${blockingJob.status}` : ""
      }.`;
  }
}

function runReasonResult(
  reason: RunReadyJobsReason,
  blockingJob?: PipelineBlockingJob
): RunReadyJobsReasonResult {
  return {
    reason,
    blockingJob,
    message: runReadyJobsReasonMessage(reason, blockingJob)
  };
}
