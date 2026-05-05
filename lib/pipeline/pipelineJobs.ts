import {
  AnalysisPassType,
  AnalysisRunStatus,
  AnalysisRunType,
  AnalysisStatus,
  type PipelineJob,
  type Prisma
} from "@prisma/client";
import {
  corpusBookIdFromPipelineJob,
  corpusPipelineJobWhere,
  isCorpusPipelineJobType,
  runCorpusPipelineJobStep,
  unblockReadyCorpusJobs,
  updateCorpusPipelineStatus
} from "@/lib/corpus/corpusAnalysisJobs";
import { jsonInput } from "@/lib/json";
import {
  findOrCreatePipelineRun,
  isPipelineStepRunComplete,
  persistPipelineCheckpoint,
  runPipelineStep
} from "@/lib/pipeline/manuscriptPipeline";
import {
  pipelineStepJobKey,
  plannedPipelineJobs
} from "@/lib/pipeline/jobPlanner";
import {
  pipelineBlockingJob,
  zeroRunReasonForJobs,
  type PipelineBlockingJob,
  type RunReadyJobsReason
} from "@/lib/pipeline/jobRunReasons";
import {
  areDependenciesComplete,
  canAttemptJob,
  dependencyIdsFromJson,
  isCompletedJob,
  isFinalSynthesisJobType,
  isJobCancelled,
  isLockStale,
  MANUAL_FINAL_SYNTHESIS_LOCK_MS,
  nextStatusAfterJobError,
  PIPELINE_JOB_STATUS,
  PIPELINE_JOB_TYPES
} from "@/lib/pipeline/jobRules";
import {
  FULL_MANUSCRIPT_PIPELINE_STEPS,
  isStepComplete,
  MANUSCRIPT_PIPELINE_STEPS,
  markStepComplete,
  markStepProgress,
  markStepStarted,
  normalizeCheckpoint,
  type ManuscriptPipelineStep
} from "@/lib/pipeline/steps";
import { prisma } from "@/lib/prisma";
import {
  draftChapterRewrite,
  regenerateChapterRewrite
} from "@/lib/rewrite/chapterRewrite";
import type { JsonRecord } from "@/lib/types";

const DEFAULT_LOCK_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ITEMS_PER_STEP = 2;

export type PipelineStartMode = "FULL_PIPELINE" | "RESUME" | "REWRITE_ONLY";

export type RunPipelineJobOptions = {
  workerId?: string;
  workerType?: "INNGEST" | "VERCEL_CRON" | "MANUAL";
  maxItemsPerStep?: number;
};

export type RunReadyJobsOptions = RunPipelineJobOptions & {
  manuscriptId?: string;
  corpusBookId?: string;
  maxJobs?: number;
  maxSeconds?: number;
  workerType?: "INNGEST" | "VERCEL_CRON" | "MANUAL";
};

export type RunReadyJobsState = "done" | "more_work_remains" | "blocked_by_error";

export type RunReadyPipelineJobsResult = {
  jobsRun: number;
  results: RunPipelineJobResult[];
  readyJobIds: string[];
  remainingReadyJobs: number;
  unfinishedJobs: number;
  failedJobs: number;
  state: RunReadyJobsState;
  moreWorkRemains: boolean;
  hasRemainingWork: boolean;
  reason?: RunReadyJobsReason;
  message?: string;
  blockingJob?: PipelineBlockingJob;
  recoveredStaleJobs: PipelineBlockingJob[];
};

export type PipelineJobScope = {
  manuscriptId?: string;
  corpusBookId?: string;
};

export type RunPipelineJobResult = {
  jobId?: string;
  manuscriptId?: string | null;
  corpusBookId?: string | null;
  type?: string;
  status:
    | "missing"
    | "completed"
    | "cancelled"
    | "blocked"
    | "locked"
    | "queued"
    | "failed"
    | "retrying";
  readyJobIds: string[];
  error?: string;
};

export async function ensureManuscriptPipelineJobs(
  manuscriptId: string,
  mode: PipelineStartMode = "FULL_PIPELINE"
) {
  const manuscript = await prisma.manuscript.findUnique({
    where: { id: manuscriptId },
    select: { id: true }
  });

  if (!manuscript) {
    throw new Error("Manuscript not found.");
  }

  const run = await findOrCreatePipelineRun(manuscriptId);
  const checkpoint = normalizeCheckpoint(run.checkpoint);
  const planned = plannedPipelineJobs(manuscriptId, checkpoint);
  const jobsByKey = new Map<string, PipelineJob>();
  const jobs: PipelineJob[] = [];

  for (const jobPlan of planned) {
    const dependencyIds = jobPlan.dependencyKeys
      .map((key) => jobsByKey.get(key)?.id)
      .filter((id): id is string => Boolean(id));
    const existing = await prisma.pipelineJob.findUnique({
      where: { idempotencyKey: jobPlan.idempotencyKey }
    });
    const completedFromCheckpoint = jobPlan.completedFromCheckpoint;
    const shouldRetryFailed =
      (mode === "RESUME" || mode === "FULL_PIPELINE") &&
      existing?.status === PIPELINE_JOB_STATUS.FAILED &&
      existing.attempts < existing.maxAttempts;
    const baseData = {
      manuscriptId,
      type: jobPlan.type,
      dependencyIds: jsonInput(dependencyIds),
      metadata: jsonInput(jobPlan.metadata),
      maxAttempts: maxAttemptsForJobType(jobPlan.type)
    };
    const job = existing
      ? await prisma.pipelineJob.update({
          where: { id: existing.id },
          data: {
            ...baseData,
            ...(completedFromCheckpoint
              ? {
                  status: PIPELINE_JOB_STATUS.COMPLETED,
                  completedAt: existing.completedAt ?? new Date(),
                  error: null,
                  lockedAt: null,
                  lockedBy: null,
                  lockExpiresAt: null
                }
              : shouldRetryFailed
                ? {
                    status: PIPELINE_JOB_STATUS.RETRYING,
                    error: null,
                    readyAt: new Date(),
                    lockedAt: null,
                    lockedBy: null,
                    lockExpiresAt: null
                  }
                : {})
          }
        })
      : await prisma.pipelineJob.create({
          data: {
            ...baseData,
            idempotencyKey: jobPlan.idempotencyKey,
            status: completedFromCheckpoint
              ? PIPELINE_JOB_STATUS.COMPLETED
              : dependencyIds.length > 0
                ? PIPELINE_JOB_STATUS.BLOCKED
                : PIPELINE_JOB_STATUS.QUEUED,
            completedAt: completedFromCheckpoint ? new Date() : undefined
          }
        });

    jobsByKey.set(jobPlan.idempotencyKey, job);
    jobs.push(job);
  }

  await unblockReadyJobs(manuscriptId);
  await updateManuscriptPipelineStatus(manuscriptId);

  return { run, jobs };
}

export async function ensureChapterRewriteJob(input: {
  manuscriptId: string;
  chapterId: string;
  rewritePlanId?: string | null;
  requestId?: string;
}) {
  const active = await prisma.pipelineJob.findFirst({
    where: {
      manuscriptId: input.manuscriptId,
      chapterId: input.chapterId,
      type: PIPELINE_JOB_TYPES.CHAPTER_REWRITE,
      status: {
        in: [
          PIPELINE_JOB_STATUS.QUEUED,
          PIPELINE_JOB_STATUS.RUNNING,
          PIPELINE_JOB_STATUS.RETRYING,
          PIPELINE_JOB_STATUS.BLOCKED
        ]
      }
    },
    orderBy: { createdAt: "desc" }
  });

  if (active) {
    return active;
  }

  const requestId = input.requestId ?? `${Date.now()}`;
  return prisma.pipelineJob.create({
    data: {
      manuscriptId: input.manuscriptId,
      chapterId: input.chapterId,
      type: PIPELINE_JOB_TYPES.CHAPTER_REWRITE,
      status: PIPELINE_JOB_STATUS.QUEUED,
      idempotencyKey: [
        "chapter-rewrite",
        input.manuscriptId,
        input.chapterId,
        input.rewritePlanId ?? "latest",
        requestId
      ].join(":"),
      maxAttempts: 2,
      metadata: jsonInput({
        rewritePlanId: input.rewritePlanId ?? null,
        requestId
      })
    }
  });
}

export async function ensureChapterRewriteDraftsJob(manuscriptId: string) {
  const run = await findOrCreatePipelineRun(manuscriptId);
  const checkpoint = normalizeCheckpoint(run.checkpoint);
  const rewritePlanComplete = isStepComplete(checkpoint, "createRewritePlan");

  if (!rewritePlanComplete) {
    throw new Error("Create the rewrite plan before generating chapter rewrite drafts.");
  }

  const idempotencyKey = pipelineStepJobKey(
    manuscriptId,
    "generateChapterRewriteDrafts"
  );
  const existing = await prisma.pipelineJob.findUnique({
    where: { idempotencyKey }
  });

  if (existing) {
    if (
      existing.status === PIPELINE_JOB_STATUS.FAILED ||
      existing.status === PIPELINE_JOB_STATUS.CANCELLED
    ) {
      return prisma.pipelineJob.update({
        where: { id: existing.id },
        data: {
          status: PIPELINE_JOB_STATUS.RETRYING,
          error: null,
          readyAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lockExpiresAt: null
        }
      });
    }

    return existing;
  }

  return prisma.pipelineJob.create({
    data: {
      manuscriptId,
      type: "generateChapterRewriteDrafts",
      status: PIPELINE_JOB_STATUS.QUEUED,
      idempotencyKey,
      dependencyIds: jsonInput([]),
      maxAttempts: maxAttemptsForJobType("generateChapterRewriteDrafts"),
      metadata: jsonInput({
        step: "generateChapterRewriteDrafts",
        order: FULL_MANUSCRIPT_PIPELINE_STEPS.length + 1,
        pipeline: "REWRITE_ONLY"
      })
    }
  });
}

export async function runReadyPipelineJobs(options: RunReadyJobsOptions = {}) {
  const workerType = options.workerType ?? "MANUAL";
  const maxJobs = positiveInt(options.maxJobs, 1);
  const maxSeconds = positiveInt(options.maxSeconds, 25);
  const scope = normalizePipelineJobScope(options);
  const startedAt = Date.now();
  const readyJobIds: string[] = [];
  const results: RunPipelineJobResult[] = [];

  if (scope.manuscriptId) {
    await ensureManuscriptPipelineJobs(scope.manuscriptId, "RESUME");
  }

  await recordWorkerHeartbeat(workerType, "RUNNING", {
    manuscriptId: scope.manuscriptId ?? null,
    corpusBookId: scope.corpusBookId ?? null
  });
  const recoveredStaleJobs = await releaseStaleLocks(scope);
  await unblockReadyJobsForScope(scope);

  while (results.length < maxJobs && Date.now() - startedAt < maxSeconds * 1000) {
    const nextJob = await findNextReadyJob(scope);
    if (!nextJob) {
      break;
    }

    const result = await runPipelineJob(nextJob.id, options);
    results.push(result);
    readyJobIds.push(...result.readyJobIds);

    if (result.status === "locked" || result.status === "queued") {
      break;
    }
  }

  await unblockReadyJobsForScope(scope);
  return buildRunReadyPipelineJobsResult({
    scope,
    workerType,
    results,
    readyJobIds,
    recoveredStaleJobs
  });
}

async function buildRunReadyPipelineJobsResult(input: {
  scope: PipelineJobScope;
  workerType: "INNGEST" | "VERCEL_CRON" | "MANUAL";
  results: RunPipelineJobResult[];
  readyJobIds: string[];
  recoveredStaleJobs: PipelineBlockingJob[];
}): Promise<RunReadyPipelineJobsResult> {
  const remainingReadyJobs = await countReadyJobs(input.scope);
  const unfinishedJobs = await countUnfinishedPipelineJobs(input.scope);
  const failedJobs = await countFailedPipelineJobs(input.scope);
  const state: RunReadyJobsState =
    failedJobs > 0
      ? "blocked_by_error"
      : unfinishedJobs > 0
        ? "more_work_remains"
        : "done";
  const reasonDetails =
    input.results.length === 0 && state !== "done"
      ? await getZeroRunReason(input.scope, state, input.recoveredStaleJobs)
      : {};
  const readyJobIds = Array.from(new Set(input.readyJobIds));

  await recordWorkerHeartbeat(input.workerType, "IDLE", {
    manuscriptId: input.scope.manuscriptId ?? null,
    corpusBookId: input.scope.corpusBookId ?? null,
    jobsRun: input.results.length,
    remainingReadyJobs,
    unfinishedJobs,
    failedJobs,
    state,
    reason: reasonDetails.reason ?? null,
    blockingJob: reasonDetails.blockingJob ?? null,
    recoveredStaleJobs: input.recoveredStaleJobs
  });

  return {
    jobsRun: input.results.length,
    results: input.results,
    readyJobIds,
    remainingReadyJobs,
    unfinishedJobs,
    failedJobs,
    state,
    moreWorkRemains: state === "more_work_remains",
    hasRemainingWork: state !== "done",
    reason: reasonDetails.reason,
    message: reasonDetails.message,
    blockingJob: reasonDetails.blockingJob,
    recoveredStaleJobs: input.recoveredStaleJobs
  };
}

async function getZeroRunReason(
  scope: PipelineJobScope,
  state: RunReadyJobsState,
  recoveredStaleJobs: PipelineBlockingJob[]
) {
  const jobs =
    recoveredStaleJobs.length > 0 ? [] : await findPotentialBlockingJobs(scope);

  return zeroRunReasonForJobs({ state, jobs, staleRecoveredJobs: recoveredStaleJobs });
}

export async function runPipelineJob(
  jobId: string,
  options: RunPipelineJobOptions = {}
): Promise<RunPipelineJobResult> {
  const job = await prisma.pipelineJob.findUnique({ where: { id: jobId } });
  if (!job) {
    return { status: "missing", readyJobIds: [] };
  }

  if (isCompletedJob(job)) {
    return jobResult(job, "completed");
  }

  if (isJobCancelled(job)) {
    return jobResult(job, "cancelled");
  }

  if (!(await dependenciesComplete(job))) {
    await prisma.pipelineJob.update({
      where: { id: job.id },
      data: { status: PIPELINE_JOB_STATUS.BLOCKED }
    });
    return jobResult(job, "blocked");
  }

  if (!canAttemptJob(job)) {
    return jobResult(
      job,
      job.status === PIPELINE_JOB_STATUS.RUNNING ? "locked" : "queued"
    );
  }

  const locked = await acquirePipelineJobLock(
    job.id,
    options.workerId,
    lockMsForJob(job.type, options.workerType)
  );
  if (!locked) {
    return jobResult(job, "locked");
  }

  try {
    const result = MANUSCRIPT_PIPELINE_STEPS.includes(
      locked.type as ManuscriptPipelineStep
    )
      ? await runManuscriptPipelineStepJob(locked, {
          maxItemsPerStep: positiveInt(
            options.maxItemsPerStep,
            DEFAULT_MAX_ITEMS_PER_STEP
          ),
          forceCompilerFallback: shouldForceCompilerFallback(options)
        })
      : isCorpusPipelineJobType(locked.type)
        ? await runCorpusPipelineStepJob(locked)
      : locked.type === PIPELINE_JOB_TYPES.CHAPTER_REWRITE
        ? await runChapterRewriteJob(locked)
        : await failUnknownJobType(locked);

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Pipeline job failed.";
    const nextStatus = nextStatusAfterJobError({
      attempts: locked.attempts,
      maxAttempts: locked.maxAttempts
    });
    const readyAt =
      nextStatus === PIPELINE_JOB_STATUS.RETRYING
        ? new Date(Date.now() + retryDelayMs(locked.attempts))
        : null;

    const updated = await prisma.pipelineJob.update({
      where: { id: locked.id },
      data: {
        status: nextStatus,
        error: message,
        readyAt,
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null
      }
    });

    if (updated.manuscriptId) {
      await updateManuscriptPipelineStatus(updated.manuscriptId);
    } else if (isCorpusPipelineJobType(updated.type)) {
      const corpusBookId = corpusBookIdFromPipelineJob(updated);
      if (corpusBookId) {
        await updateCorpusPipelineStatus(corpusBookId);
      }
    }

    return jobResult(
      updated,
      nextStatus === PIPELINE_JOB_STATUS.FAILED ? "failed" : "retrying",
      [],
      message
    );
  }
}

export async function retryPipelineJob(jobId: string) {
  const job = await prisma.pipelineJob.update({
    where: { id: jobId },
    data: {
      status: PIPELINE_JOB_STATUS.RETRYING,
      error: null,
      readyAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
      attempts: 0
    }
  });

  if (job.manuscriptId) {
    await updateManuscriptPipelineStatus(job.manuscriptId);
  } else if (isCorpusPipelineJobType(job.type)) {
    const corpusBookId = corpusBookIdFromPipelineJob(job);
    if (corpusBookId) {
      await updateCorpusPipelineStatus(corpusBookId);
    }
  }

  return job;
}

export async function cancelPipelineJob(jobId: string) {
  const job = await prisma.pipelineJob.update({
    where: { id: jobId },
    data: {
      status: PIPELINE_JOB_STATUS.CANCELLED,
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null
    }
  });

  if (job.manuscriptId) {
    await updateManuscriptPipelineStatus(job.manuscriptId);
  } else if (isCorpusPipelineJobType(job.type)) {
    const corpusBookId = corpusBookIdFromPipelineJob(job);
    if (corpusBookId) {
      await updateCorpusPipelineStatus(corpusBookId);
    }
  }

  return job;
}

export async function findNextReadyJob(scopeOrManuscriptId?: string | PipelineJobScope) {
  const scope = normalizePipelineJobScope(scopeOrManuscriptId);
  const now = new Date();
  const candidates = await prisma.pipelineJob.findMany({
    where: {
      AND: [
        pipelineJobScopeWhere(scope),
        {
          OR: [{ lockedAt: null }, { lockExpiresAt: { lte: now } }]
        }
      ],
      status: {
        in: [
          PIPELINE_JOB_STATUS.QUEUED,
          PIPELINE_JOB_STATUS.RETRYING,
          PIPELINE_JOB_STATUS.BLOCKED
        ]
      },
      OR: [{ readyAt: null }, { readyAt: { lte: now } }],
    },
    orderBy: [{ readyAt: "asc" }, { createdAt: "asc" }],
    take: 50
  });

  for (const candidate of candidates) {
    if (!canAttemptJob(candidate, now)) {
      continue;
    }

    if (
      candidate.status === PIPELINE_JOB_STATUS.RETRYING &&
      candidate.attempts >= candidate.maxAttempts
    ) {
      await prisma.pipelineJob.update({
        where: { id: candidate.id },
        data: { status: PIPELINE_JOB_STATUS.FAILED }
      });
      continue;
    }

    if (!(await dependenciesComplete(candidate))) {
      if (candidate.status !== PIPELINE_JOB_STATUS.BLOCKED) {
        await prisma.pipelineJob.update({
          where: { id: candidate.id },
          data: { status: PIPELINE_JOB_STATUS.BLOCKED }
        });
      }
      continue;
    }

    if (candidate.status === PIPELINE_JOB_STATUS.BLOCKED) {
      return prisma.pipelineJob.update({
        where: { id: candidate.id },
        data: { status: PIPELINE_JOB_STATUS.QUEUED }
      });
    }

    return candidate;
  }

  return null;
}

export async function releaseStaleLocks(scopeOrManuscriptId?: string | PipelineJobScope) {
  const scope = normalizePipelineJobScope(scopeOrManuscriptId);
  const now = new Date();
  const runningJobs = await prisma.pipelineJob.findMany({
    where: {
      ...pipelineJobScopeWhere(scope),
      status: PIPELINE_JOB_STATUS.RUNNING
    }
  });
  const staleJobs = runningJobs.filter((job) => isLockStale(job, now));
  const recoveredJobs = staleJobs.map((job) => pipelineBlockingJob(job, now));

  for (const job of staleJobs) {
    const hasIncompleteProgress = hasIncompleteStepResult(job.result);
    const shouldRequeue = hasIncompleteProgress || isResumableCompilerJob(job);
    const status = shouldRequeue
      ? PIPELINE_JOB_STATUS.QUEUED
      : nextStatusAfterJobError({
          attempts: job.attempts,
          maxAttempts: job.maxAttempts
        });
    const updated = await prisma.pipelineJob.update({
      where: { id: job.id },
      data: {
        status,
        error: shouldRequeue
          ? null
          : job.error ?? "Job lock expired before completion.",
        ...(shouldRequeue
          ? { attempts: attemptsAfterPartialProgress(job) }
          : {}),
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
        readyAt: status === PIPELINE_JOB_STATUS.RETRYING ? now : null
      }
    });

    if (updated.manuscriptId) {
      await updateManuscriptPipelineStatus(updated.manuscriptId);
    } else if (isCorpusPipelineJobType(updated.type)) {
      const corpusBookId = corpusBookIdFromPipelineJob(updated);
      if (corpusBookId) {
        await updateCorpusPipelineStatus(corpusBookId);
      }
    }
  }

  return recoveredJobs;
}

export async function recordWorkerHeartbeat(
  workerType: "INNGEST" | "VERCEL_CRON" | "MANUAL",
  status: string,
  metadata: Record<string, unknown> = {}
) {
  return prisma.workerHeartbeat.upsert({
    where: { workerType },
    create: {
      workerType,
      status,
      lastSeenAt: new Date(),
      metadata: jsonInput(metadata)
    },
    update: {
      status,
      lastSeenAt: new Date(),
      metadata: jsonInput(metadata)
    }
  });
}

async function runManuscriptPipelineStepJob(
  job: PipelineJob,
  options: {
    maxItemsPerStep: number;
    forceCompilerFallback: boolean;
  }
): Promise<RunPipelineJobResult> {
  if (!job.manuscriptId) {
    throw new Error("Pipeline step job is missing manuscriptId.");
  }

  const step = job.type as ManuscriptPipelineStep;
  const run = await findOrCreatePipelineRun(job.manuscriptId);
  let checkpoint = normalizeCheckpoint(run.checkpoint);

  await prisma.manuscript.update({
    where: { id: job.manuscriptId },
    data: {
      status: "PIPELINE_RUNNING",
      analysisStatus: AnalysisStatus.RUNNING
    }
  });

  if (isStepComplete(checkpoint, step)) {
    const completed = await markJobCompleted(job, { reusedCheckpoint: true });
    return jobResult(completed, "completed", await afterJobCompleted(completed));
  }

  checkpoint = await persistPipelineCheckpoint(
    run.id,
    markStepStarted(checkpoint, step)
  );
  const metadata = await runPipelineStep(step, job.manuscriptId, run.id, {
    maxItems: options.maxItemsPerStep,
    forceCompilerFallback: options.forceCompilerFallback
  });

  if (!isPipelineStepRunComplete(metadata)) {
    await persistPipelineCheckpoint(
      run.id,
      markStepProgress(checkpoint, step, metadata)
    );
    const queued = await prisma.pipelineJob.update({
      where: { id: job.id },
      data: {
        status: PIPELINE_JOB_STATUS.QUEUED,
        result: jsonInput(metadata),
        attempts: attemptsAfterPartialProgress(job),
        error: null,
        readyAt: null,
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null
      }
    });
    await updateManuscriptPipelineStatus(job.manuscriptId);
    return jobResult(queued, "queued", [queued.id]);
  }

  checkpoint = await persistPipelineCheckpoint(
    run.id,
    markStepComplete(checkpoint, step, metadata)
  );
  await prisma.analysisRun.update({
    where: { id: run.id },
    data: { checkpoint: jsonInput(checkpoint) }
  });
  const completed = await markJobCompleted(job, metadata);
  const readyJobIds = await afterJobCompleted(completed);

  return jobResult(completed, "completed", readyJobIds);
}

async function runCorpusPipelineStepJob(
  job: PipelineJob
): Promise<RunPipelineJobResult> {
  const metadata = await runCorpusPipelineJobStep(job);
  const completed = await markJobCompleted(job, metadata);

  return jobResult(completed, "completed", await afterJobCompleted(completed));
}

async function runChapterRewriteJob(
  job: PipelineJob
): Promise<RunPipelineJobResult> {
  if (!job.manuscriptId || !job.chapterId) {
    throw new Error("Chapter rewrite job is missing manuscriptId or chapterId.");
  }

  const metadata = toJsonRecord(job.metadata);
  const rewritePlanId = stringOrUndefined(metadata.rewritePlanId);

  if (rewritePlanId) {
    const run = await prisma.analysisRun.findFirst({
      where: {
        manuscriptId: job.manuscriptId,
        type: AnalysisRunType.FULL_AUDIT,
        status: AnalysisRunStatus.COMPLETED
      },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }]
    });

    if (!run) {
      throw new Error("Run the full manuscript pipeline before rewriting a chapter.");
    }

    await prisma.chapterRewrite.updateMany({
      where: {
        manuscriptId: job.manuscriptId,
        chapterId: job.chapterId,
        status: "DRAFT"
      },
      data: { status: "REJECTED" }
    });
    const result = await draftChapterRewrite({
      manuscriptId: job.manuscriptId,
      chapterId: job.chapterId,
      runId: run.id,
      rewritePlanId,
      forceNewVersion: true
    });
    const completed = await markJobCompleted(job, {
      rewriteId: result.rewrite.id,
      created: result.created
    });

    return jobResult(completed, "completed", await afterJobCompleted(completed));
  }

  const result = await regenerateChapterRewrite(job.manuscriptId, job.chapterId);
  const completed = await markJobCompleted(job, {
    rewriteId: result.rewrite.id,
    created: result.created
  });

  return jobResult(completed, "completed", await afterJobCompleted(completed));
}

async function failUnknownJobType(job: PipelineJob): Promise<RunPipelineJobResult> {
  throw new Error(`Unknown pipeline job type: ${job.type}`);
}

async function acquirePipelineJobLock(
  jobId: string,
  workerId = "worker",
  lockMs = DEFAULT_LOCK_MS
) {
  const now = new Date();
  const lockExpiresAt = new Date(now.getTime() + lockMs);
  const update = await prisma.pipelineJob.updateMany({
    where: {
      id: jobId,
      status: {
        in: [
          PIPELINE_JOB_STATUS.QUEUED,
          PIPELINE_JOB_STATUS.RETRYING,
          PIPELINE_JOB_STATUS.BLOCKED
        ]
      },
      OR: [{ lockedAt: null }, { lockExpiresAt: { lte: now } }]
    },
    data: {
      status: PIPELINE_JOB_STATUS.RUNNING,
      lockedAt: now,
      lockedBy: workerId,
      lockExpiresAt,
      startedAt: now,
      attempts: { increment: 1 }
    }
  });

  if (update.count === 0) {
    return null;
  }

  return prisma.pipelineJob.findUnique({ where: { id: jobId } });
}

async function dependenciesComplete(job: PipelineJob) {
  const dependencyIds = dependencyIdsFromJson(job.dependencyIds);
  if (dependencyIds.length === 0) {
    return true;
  }

  const dependencies = await prisma.pipelineJob.findMany({
    where: { id: { in: dependencyIds } },
    select: { id: true, status: true }
  });

  return areDependenciesComplete(dependencyIds, dependencies);
}

async function unblockReadyJobs(manuscriptId: string) {
  const candidates = await prisma.pipelineJob.findMany({
    where: {
      manuscriptId,
      status: PIPELINE_JOB_STATUS.BLOCKED
    },
    orderBy: { createdAt: "asc" }
  });
  const readyJobIds: string[] = [];

  for (const candidate of candidates) {
    if (await dependenciesComplete(candidate)) {
      const updated = await prisma.pipelineJob.update({
        where: { id: candidate.id },
        data: { status: PIPELINE_JOB_STATUS.QUEUED }
      });
      readyJobIds.push(updated.id);
    }
  }

  return readyJobIds;
}

async function afterJobCompleted(job: PipelineJob) {
  const corpusBookId = isCorpusPipelineJobType(job.type)
    ? corpusBookIdFromPipelineJob(job)
    : null;
  const readyJobIds = job.manuscriptId
    ? await unblockReadyJobs(job.manuscriptId)
    : corpusBookId
      ? await unblockReadyCorpusJobs(corpusBookId)
      : [];

  if (job.manuscriptId) {
    await updateManuscriptPipelineStatus(job.manuscriptId);
  } else if (corpusBookId) {
    await updateCorpusPipelineStatus(corpusBookId);
  }

  return readyJobIds;
}

async function unblockReadyJobsForScope(scope: PipelineJobScope) {
  if (scope.manuscriptId) {
    return unblockReadyJobs(scope.manuscriptId);
  }

  if (scope.corpusBookId) {
    return unblockReadyCorpusJobs(scope.corpusBookId);
  }

  return [];
}

async function findPotentialBlockingJobs(scope: PipelineJobScope) {
  return prisma.pipelineJob.findMany({
    where: {
      ...pipelineJobScopeWhere(scope),
      status: {
        in: [
          PIPELINE_JOB_STATUS.RUNNING,
          PIPELINE_JOB_STATUS.FAILED,
          PIPELINE_JOB_STATUS.QUEUED,
          PIPELINE_JOB_STATUS.RETRYING,
          PIPELINE_JOB_STATUS.BLOCKED
        ]
      }
    },
    orderBy: [{ createdAt: "asc" }],
    take: 50
  });
}

async function markJobCompleted(
  job: PipelineJob,
  result: Record<string, unknown>
) {
  return prisma.pipelineJob.update({
    where: { id: job.id },
    data: {
      status: PIPELINE_JOB_STATUS.COMPLETED,
      result: jsonInput(result),
      error: null,
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null
    }
  });
}

async function updateManuscriptPipelineStatus(manuscriptId: string) {
  const jobs = await prisma.pipelineJob.findMany({
    where: {
      manuscriptId,
      type: { in: [...FULL_MANUSCRIPT_PIPELINE_STEPS] }
    },
    select: { status: true }
  });

  if (jobs.length === 0) {
    return;
  }

  const allCompleted = jobs.every(
    (job) => job.status === PIPELINE_JOB_STATUS.COMPLETED
  );
  const anyFailed = jobs.some((job) => job.status === PIPELINE_JOB_STATUS.FAILED);
  const allCancelled = jobs.every(
    (job) => job.status === PIPELINE_JOB_STATUS.CANCELLED
  );
  const anyBlocked = jobs.some(
    (job) => job.status === PIPELINE_JOB_STATUS.BLOCKED
  );
  const run = await prisma.analysisRun.findFirst({
    where: {
      manuscriptId,
      type: AnalysisRunType.FULL_AUDIT
    },
    orderBy: { createdAt: "desc" }
  });

  if (allCompleted) {
    if (run) {
      await prisma.analysisRun.update({
        where: { id: run.id },
        data: {
          status: AnalysisRunStatus.COMPLETED,
          completedAt: new Date(),
          currentPass: AnalysisPassType.SYNTHESIS,
          error: null
        }
      });
    }
    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        status: "PIPELINE_COMPLETED",
        analysisStatus: AnalysisStatus.COMPLETED
      }
    });
    return;
  }

  if (anyFailed || allCancelled) {
    if (run) {
      await prisma.analysisRun.update({
        where: { id: run.id },
        data: {
          status: AnalysisRunStatus.FAILED,
          error: anyFailed
            ? "One or more pipeline jobs failed."
            : "Pipeline jobs were cancelled."
        }
      });
    }
    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        status: allCancelled ? "PIPELINE_CANCELLED" : "PIPELINE_FAILED",
        analysisStatus: AnalysisStatus.FAILED
      }
    });
    return;
  }

  await prisma.manuscript.update({
    where: { id: manuscriptId },
    data: {
      status: anyBlocked ? "PIPELINE_BLOCKED" : "PIPELINE_RUNNING",
      analysisStatus: AnalysisStatus.RUNNING
    }
  });
}

async function countReadyJobs(scopeOrManuscriptId?: string | PipelineJobScope) {
  const scope = normalizePipelineJobScope(scopeOrManuscriptId);
  const now = new Date();
  return prisma.pipelineJob.count({
    where: {
      ...pipelineJobScopeWhere(scope),
      status: {
        in: [PIPELINE_JOB_STATUS.QUEUED, PIPELINE_JOB_STATUS.RETRYING]
      },
      OR: [{ readyAt: null }, { readyAt: { lte: now } }]
    }
  });
}

async function countUnfinishedPipelineJobs(scopeOrManuscriptId?: string | PipelineJobScope) {
  const scope = normalizePipelineJobScope(scopeOrManuscriptId);
  return prisma.pipelineJob.count({
    where: {
      ...pipelineJobScopeWhere(scope),
      status: {
        in: [
          PIPELINE_JOB_STATUS.QUEUED,
          PIPELINE_JOB_STATUS.RUNNING,
          PIPELINE_JOB_STATUS.RETRYING,
          PIPELINE_JOB_STATUS.BLOCKED
        ]
      }
    }
  });
}

async function countFailedPipelineJobs(scopeOrManuscriptId?: string | PipelineJobScope) {
  const scope = normalizePipelineJobScope(scopeOrManuscriptId);
  return prisma.pipelineJob.count({
    where: {
      ...pipelineJobScopeWhere(scope),
      status: PIPELINE_JOB_STATUS.FAILED
    }
  });
}

export function pipelineJobScopeWhere(
  scopeOrManuscriptId?: string | PipelineJobScope
): Prisma.PipelineJobWhereInput {
  const scope = normalizePipelineJobScope(scopeOrManuscriptId);

  if (scope.manuscriptId && scope.corpusBookId) {
    throw new Error("Pipeline job scope cannot include both manuscriptId and corpusBookId.");
  }

  if (scope.manuscriptId) {
    return { manuscriptId: scope.manuscriptId };
  }

  if (scope.corpusBookId) {
    return corpusPipelineJobWhere(scope.corpusBookId);
  }

  return {};
}

function jobResult(
  job: PipelineJob,
  status: RunPipelineJobResult["status"],
  readyJobIds: string[] = [],
  error?: string
): RunPipelineJobResult {
  return {
    jobId: job.id,
    manuscriptId: job.manuscriptId,
    corpusBookId: isCorpusPipelineJobType(job.type)
      ? corpusBookIdFromPipelineJob(job)
      : null,
    type: job.type,
    status,
    readyJobIds,
    error
  };
}

function positiveInt(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function retryDelayMs(attempts: number) {
  return Math.min(5 * 60 * 1000, Math.max(10_000, attempts * 30_000));
}

function attemptsAfterPartialProgress(job: PipelineJob) {
  const beforeThisRun = Math.max(job.attempts - 1, 0);
  return Math.min(beforeThisRun, Math.max(job.maxAttempts - 1, 0));
}

function hasIncompleteStepResult(result: unknown) {
  const record = toJsonRecord(result);
  return record.complete === false || numberOrZero(record.remaining) > 0;
}

function isResumableCompilerJob(job: PipelineJob) {
  return (
    job.type === "compileWholeBookMap" ||
    job.type === "createNextBestEditorialActions"
  );
}

function shouldForceCompilerFallback(options: RunPipelineJobOptions) {
  return options.workerType === "MANUAL";
}

function lockMsForJob(type: string, workerType?: RunPipelineJobOptions["workerType"]) {
  if (workerType === "MANUAL" && isFinalSynthesisJobType(type)) {
    return MANUAL_FINAL_SYNTHESIS_LOCK_MS;
  }

  return DEFAULT_LOCK_MS;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function maxAttemptsForJobType(type: string) {
  return type === "generateChapterRewriteDrafts" ? 2 : 3;
}

function normalizePipelineJobScope(
  scopeOrManuscriptId?: string | PipelineJobScope
): PipelineJobScope {
  if (typeof scopeOrManuscriptId === "string") {
    return { manuscriptId: scopeOrManuscriptId };
  }

  return {
    manuscriptId: stringOrUndefined(scopeOrManuscriptId?.manuscriptId),
    corpusBookId: stringOrUndefined(scopeOrManuscriptId?.corpusBookId)
  };
}

function toJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
