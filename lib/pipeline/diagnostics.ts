import type { PipelineJob } from "@prisma/client";
import {
  zeroRunReasonForJobs,
  type PipelineBlockingJob,
  type RunReadyJobsReason,
  type RunReadyJobsReasonResult
} from "@/lib/pipeline/jobRunReasons";
import {
  canAttemptJob,
  dependencyIdsFromJson,
  isLockStale,
  PIPELINE_JOB_STATUS
} from "@/lib/pipeline/jobRules";
import {
  FULL_MANUSCRIPT_PIPELINE_STEPS,
  normalizeCheckpoint,
  type ManuscriptPipelineStep
} from "@/lib/pipeline/steps";
import { buildPipelineStatusDisplay } from "@/lib/pipeline/display";
import { getWorkspaceReadinessForManuscript } from "@/lib/pipeline/workspaceReadiness";
import { getModelRoleDiagnostics } from "@/lib/ai/modelConfig";
import { getChunkSummaryProgress } from "@/lib/pipeline/chunkSummaryProgress";
import { prisma } from "@/lib/prisma";

export type PipelineJobDiagnostic = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  readyAt: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  lockExpiresAt: string | null;
  stale: boolean;
  blockedReason: string | null;
};

export async function getManuscriptPipelineDiagnostics(manuscriptId: string) {
  const now = new Date();
  const [manuscript, run, jobs, readiness] = await Promise.all([
    prisma.manuscript.findUnique({
      where: { id: manuscriptId },
      select: {
        id: true,
        chapterCount: true,
        chunkCount: true
      }
    }),
    prisma.analysisRun.findFirst({
      where: { manuscriptId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        checkpoint: true,
        error: true,
        updatedAt: true
      }
    }),
    prisma.pipelineJob.findMany({
      where: { manuscriptId },
      orderBy: [{ createdAt: "asc" }]
    }),
    getWorkspaceReadinessForManuscript(manuscriptId)
  ]);

  if (!manuscript) {
    throw new Error("Manuscript not found.");
  }

  const chunkSummaryProgress = await getChunkSummaryProgress(
    manuscriptId,
    run?.id
  );
  const checkpoint = normalizeCheckpoint(run?.checkpoint);
  const completedSteps = new Set(checkpoint.completedSteps ?? []);
  const currentStep =
    stepOrNull(checkpoint.currentStep) ??
    FULL_MANUSCRIPT_PIPELINE_STEPS.find((step) => !completedSteps.has(step)) ??
    null;
  const diagnostics = jobs.map((job) => jobDiagnostic(job, jobs, now));
  const nextEligibleJob = diagnostics.find((job) =>
    isEligibleDiagnostic(job, jobs, now)
  );
  const activeStatuses = new Set<string>([
    PIPELINE_JOB_STATUS.QUEUED,
    PIPELINE_JOB_STATUS.RUNNING,
    PIPELINE_JOB_STATUS.RETRYING,
    PIPELINE_JOB_STATUS.BLOCKED
  ]);
  const remainingJobs = diagnostics.filter((job) =>
    activeStatuses.has(job.status)
  );
  const failedJobs = diagnostics.filter(
    (job) => job.status === PIPELINE_JOB_STATUS.FAILED
  );
  const runningJobs = diagnostics.filter(
    (job) => job.status === PIPELINE_JOB_STATUS.RUNNING
  );
  const runnerState =
    failedJobs.length > 0
      ? "blocked_by_error"
      : remainingJobs.length > 0
        ? "more_work_remains"
        : "done";
  const zeroRunDetails: RunReadyJobsReasonResult = nextEligibleJob
    ? {}
    : zeroRunReasonForJobs({ state: runnerState, jobs, now });
  const pipelineStatus = buildPipelineStatusDisplay({
    run,
    jobs,
    totals: {
      chunks: chunkSummaryProgress.total,
      summarizedChunks: chunkSummaryProgress.summarized,
      chapters: manuscript.chapterCount,
      sections: manuscript.chapterCount,
      auditTargets: manuscript.chapterCount
    }
  });

  return {
    manuscriptId,
    state: runnerState,
    run: run
      ? {
          id: run.id,
          status: run.status,
          error: run.error,
          updatedAt: run.updatedAt.toISOString()
        }
      : null,
    pipelineStatus,
    chunkSummaryProgress,
    modelRoles: getModelRoleDiagnostics(),
    currentStep,
    completedSteps: Array.from(completedSteps),
    remainingJobCount: remainingJobs.length,
    activeRunningJobs: runningJobs.filter((job) => !job.stale),
    staleRunningJobs: runningJobs.filter((job) => job.stale),
    manualRunner: {
      reason: (zeroRunDetails.reason ?? null) as RunReadyJobsReason | null,
      message: zeroRunDetails.message ?? null,
      blockingJob: (zeroRunDetails.blockingJob ?? null) as PipelineBlockingJob | null
    },
    nextEligibleJob: nextEligibleJob
      ? {
          id: nextEligibleJob.id,
          type: nextEligibleJob.type,
          status: nextEligibleJob.status
        }
      : null,
    blockedJobs: diagnostics.filter(
      (job) => job.status === PIPELINE_JOB_STATUS.BLOCKED
    ),
    jobs: diagnostics,
    workspace: {
      state: readiness.state,
      ready: readiness.workspaceReady,
      usableWholeBookOutput: readiness.usableWholeBookOutput,
      actionableError: readiness.actionableError,
      contract: readiness.contract
    }
  };
}

function jobDiagnostic(
  job: PipelineJob,
  allJobs: PipelineJob[],
  now: Date
): PipelineJobDiagnostic {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    readyAt: job.readyAt?.toISOString() ?? null,
    lockedBy: job.lockedBy,
    lockedAt: job.lockedAt?.toISOString() ?? null,
    lockExpiresAt: job.lockExpiresAt?.toISOString() ?? null,
    stale: isLockStale(job, now),
    blockedReason:
      job.status === PIPELINE_JOB_STATUS.BLOCKED
        ? blockedReason(job, allJobs, now)
        : null
  };
}

function isEligibleDiagnostic(
  diagnostic: PipelineJobDiagnostic,
  allJobs: PipelineJob[],
  now: Date
) {
  const job = allJobs.find((candidate) => candidate.id === diagnostic.id);
  if (!job || !canAttemptJob(job, now)) {
    return false;
  }

  if (
    job.status === PIPELINE_JOB_STATUS.RETRYING &&
    job.attempts >= job.maxAttempts
  ) {
    return false;
  }

  return dependenciesComplete(job, allJobs);
}

function blockedReason(job: PipelineJob, allJobs: PipelineJob[], now: Date) {
  if (job.readyAt && job.readyAt > now) {
    return `Waiting until ${job.readyAt.toISOString()}.`;
  }

  if (job.lockedAt && !isLockStale(job, now)) {
    return `Locked by ${job.lockedBy ?? "worker"} until ${
      job.lockExpiresAt?.toISOString() ?? "lock expiry"
    }.`;
  }

  if (job.attempts >= job.maxAttempts) {
    return "Attempt limit reached; retry the job after reviewing the error.";
  }

  const dependencyIds = dependencyIdsFromJson(job.dependencyIds);
  if (dependencyIds.length === 0) {
    return "Blocked but no dependencies are recorded.";
  }

  const dependencyById = new Map(allJobs.map((candidate) => [candidate.id, candidate]));
  const missing = dependencyIds.filter((id) => !dependencyById.has(id));
  if (missing.length > 0) {
    return `Missing dependency jobs: ${missing.join(", ")}.`;
  }

  const incomplete: PipelineJob[] = [];
  for (const dependencyId of dependencyIds) {
    const dependency = dependencyById.get(dependencyId);
    if (dependency && dependency.status !== PIPELINE_JOB_STATUS.COMPLETED) {
      incomplete.push(dependency);
    }
  }

  if (incomplete.length === 0) {
    return "Dependencies are complete; the next runner pass should queue this job.";
  }

  const terminalStatuses = new Set<string>([
    PIPELINE_JOB_STATUS.FAILED,
    PIPELINE_JOB_STATUS.CANCELLED
  ]);
  const terminal = incomplete.filter((dependency) =>
    terminalStatuses.has(dependency.status)
  );

  if (terminal.length > 0) {
    return `Blocked by terminal dependency: ${terminal
      .map((dependency) => `${dependency.type} ${dependency.status}`)
      .join(", ")}.`;
  }

  return `Waiting on dependencies: ${incomplete
    .map((dependency) => `${dependency.type} ${dependency.status}`)
    .join(", ")}.`;
}

function dependenciesComplete(job: PipelineJob, allJobs: PipelineJob[]) {
  const dependencyIds = dependencyIdsFromJson(job.dependencyIds);
  const completed = new Set(
    allJobs
      .filter((candidate) => candidate.status === PIPELINE_JOB_STATUS.COMPLETED)
      .map((candidate) => candidate.id)
  );

  return dependencyIds.every((id) => completed.has(id));
}

function stepOrNull(value: unknown): ManuscriptPipelineStep | null {
  return typeof value === "string" &&
    FULL_MANUSCRIPT_PIPELINE_STEPS.includes(
      value as (typeof FULL_MANUSCRIPT_PIPELINE_STEPS)[number]
    )
    ? (value as ManuscriptPipelineStep)
    : null;
}
