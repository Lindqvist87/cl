import {
  AnalysisPassType,
  AnalysisRunStatus,
  AnalysisRunType,
  AnalysisStatus,
  type PipelineJob
} from "@prisma/client";
import {
  corpusBookIdFromPipelineJob,
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
  plannedPipelineJobs
} from "@/lib/pipeline/jobPlanner";
import {
  areDependenciesComplete,
  canAttemptJob,
  dependencyIdsFromJson,
  isCompletedJob,
  isJobCancelled,
  isLockStale,
  nextStatusAfterJobError,
  PIPELINE_JOB_STATUS,
  PIPELINE_JOB_TYPES
} from "@/lib/pipeline/jobRules";
import {
  FULL_MANUSCRIPT_PIPELINE_STEPS,
  isStepComplete,
  markStepComplete,
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
const DEFAULT_MAX_ITEMS_PER_STEP = 1;

export type PipelineStartMode = "FULL_PIPELINE" | "RESUME" | "REWRITE_ONLY";

export type RunPipelineJobOptions = {
  workerId?: string;
  maxItemsPerStep?: number;
};

export type RunReadyJobsOptions = RunPipelineJobOptions & {
  manuscriptId?: string;
  maxJobs?: number;
  maxSeconds?: number;
  workerType?: "INNGEST" | "VERCEL_CRON" | "MANUAL";
};

export type RunPipelineJobResult = {
  jobId?: string;
  manuscriptId?: string | null;
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
      mode === "RESUME" &&
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

export async function runReadyPipelineJobs(options: RunReadyJobsOptions = {}) {
  const workerType = options.workerType ?? "MANUAL";
  const maxJobs = positiveInt(options.maxJobs, 1);
  const maxSeconds = positiveInt(options.maxSeconds, 25);
  const startedAt = Date.now();
  const readyJobIds: string[] = [];
  const results: RunPipelineJobResult[] = [];

  await recordWorkerHeartbeat(workerType, "RUNNING", {
    manuscriptId: options.manuscriptId ?? null
  });
  await releaseStaleLocks(options.manuscriptId);

  while (results.length < maxJobs && Date.now() - startedAt < maxSeconds * 1000) {
    const nextJob = await findNextReadyJob(options.manuscriptId);
    if (!nextJob) {
      break;
    }

    const result = await runPipelineJob(nextJob.id, options);
    results.push(result);
    readyJobIds.push(...result.readyJobIds);

    if (result.status === "locked") {
      break;
    }
  }

  const remainingReadyJobs = await countReadyJobs(options.manuscriptId);
  await recordWorkerHeartbeat(workerType, "IDLE", {
    manuscriptId: options.manuscriptId ?? null,
    jobsRun: results.length,
    remainingReadyJobs
  });

  return {
    jobsRun: results.length,
    results,
    readyJobIds: Array.from(new Set(readyJobIds)),
    remainingReadyJobs,
    hasRemainingWork:
      remainingReadyJobs > 0 ||
      (await hasUnfinishedPipelineJobs(options.manuscriptId))
  };
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

  const locked = await acquirePipelineJobLock(job.id, options.workerId);
  if (!locked) {
    return jobResult(job, "locked");
  }

  try {
    const result = FULL_MANUSCRIPT_PIPELINE_STEPS.includes(
      locked.type as ManuscriptPipelineStep
    )
      ? await runManuscriptPipelineStepJob(
          locked,
          positiveInt(options.maxItemsPerStep, DEFAULT_MAX_ITEMS_PER_STEP)
        )
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
      lockExpiresAt: null
    }
  });

  if (job.manuscriptId) {
    await updateManuscriptPipelineStatus(job.manuscriptId);
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
  }

  return job;
}

export async function findNextReadyJob(manuscriptId?: string) {
  const now = new Date();
  const candidates = await prisma.pipelineJob.findMany({
    where: {
      ...(manuscriptId ? { manuscriptId } : {}),
      status: {
        in: [
          PIPELINE_JOB_STATUS.QUEUED,
          PIPELINE_JOB_STATUS.RETRYING,
          PIPELINE_JOB_STATUS.BLOCKED
        ]
      },
      OR: [{ readyAt: null }, { readyAt: { lte: now } }],
      AND: [
        {
          OR: [{ lockedAt: null }, { lockExpiresAt: { lte: now } }]
        }
      ]
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

export async function releaseStaleLocks(manuscriptId?: string) {
  const now = new Date();
  const staleJobs = await prisma.pipelineJob.findMany({
    where: {
      ...(manuscriptId ? { manuscriptId } : {}),
      status: PIPELINE_JOB_STATUS.RUNNING,
      lockExpiresAt: { lte: now }
    }
  });

  for (const job of staleJobs) {
    const status = nextStatusAfterJobError({
      attempts: job.attempts,
      maxAttempts: job.maxAttempts
    });
    await prisma.pipelineJob.update({
      where: { id: job.id },
      data: {
        status,
        error: job.error ?? "Job lock expired before completion.",
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
        readyAt: status === PIPELINE_JOB_STATUS.RETRYING ? now : null
      }
    });
  }

  return staleJobs.length;
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
  maxItemsPerStep: number
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
    maxItems: maxItemsPerStep
  });

  if (!isPipelineStepRunComplete(metadata)) {
    const queued = await prisma.pipelineJob.update({
      where: { id: job.id },
      data: {
        status: PIPELINE_JOB_STATUS.QUEUED,
        result: jsonInput(metadata),
        error: null,
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null
      }
    });
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

async function acquirePipelineJobLock(jobId: string, workerId = "worker") {
  const now = new Date();
  const lockExpiresAt = new Date(now.getTime() + DEFAULT_LOCK_MS);
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

async function countReadyJobs(manuscriptId?: string) {
  const now = new Date();
  return prisma.pipelineJob.count({
    where: {
      ...(manuscriptId ? { manuscriptId } : {}),
      status: {
        in: [PIPELINE_JOB_STATUS.QUEUED, PIPELINE_JOB_STATUS.RETRYING]
      },
      OR: [{ readyAt: null }, { readyAt: { lte: now } }]
    }
  });
}

async function hasUnfinishedPipelineJobs(manuscriptId?: string) {
  const count = await prisma.pipelineJob.count({
    where: {
      ...(manuscriptId ? { manuscriptId } : {}),
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

  return count > 0;
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

function maxAttemptsForJobType(type: string) {
  return type === "generateChapterRewriteDrafts" ? 2 : 3;
}

function toJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
