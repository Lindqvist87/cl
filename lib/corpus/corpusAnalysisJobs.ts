import {
  CorpusAnalysisStatus,
  CorpusIngestionStatus,
  RightsStatus,
  type PipelineJob,
  type Prisma
} from "@prisma/client";
import { createEmbedding, hasEditorModelKey } from "@/lib/ai/editorModel";
import { calculateProfileMetrics } from "@/lib/analysis/textMetrics";
import {
  chapterMetrics,
  chaptersForProfile,
  corpusBenchmarkBlockedReason,
  profileDataFromMetrics
} from "@/lib/corpus/bookDna";
import { cleanGutenbergText } from "@/lib/corpus/textProcessing";
import { jsonInput } from "@/lib/json";
import {
  areDependenciesComplete,
  canAttemptJob,
  dependencyIdsFromJson,
  nextStatusAfterJobError,
  PIPELINE_JOB_STATUS
} from "@/lib/pipeline/jobRules";
import { chunkParsedManuscript } from "@/lib/parsing/chunker";
import { parseManuscriptText } from "@/lib/parsing/chapterDetector";
import { prisma } from "@/lib/prisma";
import { countWords, normalizeWhitespace, truncateWords } from "@/lib/text/wordCount";
import type { JsonRecord, ParsedManuscript } from "@/lib/types";

export const CORPUS_PIPELINE_JOB_TYPES = {
  CORPUS_CLEAN: "CORPUS_CLEAN",
  CORPUS_CHAPTERS: "CORPUS_CHAPTERS",
  CORPUS_CHUNK: "CORPUS_CHUNK",
  CORPUS_EMBED: "CORPUS_EMBED",
  CORPUS_PROFILE: "CORPUS_PROFILE",
  CORPUS_BENCHMARK_CHECK: "CORPUS_BENCHMARK_CHECK"
} as const;

export const CORPUS_ANALYSIS_PIPELINE_NAME = "CORPUS_ANALYSIS" as const;

export type CorpusPipelineJobType =
  (typeof CORPUS_PIPELINE_JOB_TYPES)[keyof typeof CORPUS_PIPELINE_JOB_TYPES];

export const CORPUS_PIPELINE_JOB_SEQUENCE = [
  CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN,
  CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS,
  CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHUNK,
  CORPUS_PIPELINE_JOB_TYPES.CORPUS_EMBED,
  CORPUS_PIPELINE_JOB_TYPES.CORPUS_PROFILE,
  CORPUS_PIPELINE_JOB_TYPES.CORPUS_BENCHMARK_CHECK
] as const;

const FULL_TEXT_RIGHTS = new Set<RightsStatus>([
  RightsStatus.PUBLIC_DOMAIN,
  RightsStatus.OPEN_LICENSE,
  RightsStatus.LICENSED,
  RightsStatus.PRIVATE_REFERENCE
]);

type ImportProgress = {
  uploaded: boolean;
  textExtracted: boolean;
  cleaned: boolean;
  chaptersDetected: boolean;
  chunksCreated: boolean;
  embeddingsCreated: boolean;
  bookDnaExtracted: boolean;
  benchmarkReady: boolean;
  embeddingStatus?: string;
  benchmarkBlockedReason?: string | null;
  error?: string;
};

export type CorpusAnalysisStepState =
  | "not_started"
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "blocked"
  | "skipped";

export type CorpusAnalysisStepSummary = {
  label: string;
  status: CorpusAnalysisStepState;
  statusLabel: string;
  detail?: string | null;
};

export type CorpusAnalysisSummary = {
  bookId: string;
  ingestionStatus: string;
  analysisStatus: string;
  benchmarkReady: boolean;
  benchmarkBlockedReason: string | null;
  readyJobCount: number;
  runningJobCount: number;
  unfinishedJobCount: number;
  jobCount: number;
  jobs: Array<{
    id: string;
    type: string;
    status: string;
    error: string | null;
  }>;
  steps: {
    imported: CorpusAnalysisStepSummary;
    cleaning: CorpusAnalysisStepSummary;
    chapters: CorpusAnalysisStepSummary;
    chunks: CorpusAnalysisStepSummary;
    embeddings: CorpusAnalysisStepSummary;
    bookDna: CorpusAnalysisStepSummary;
    benchmark: CorpusAnalysisStepSummary & {
      ready: boolean;
      blockingReason: string | null;
    };
  };
};

export type PlannedCorpusPipelineJob = {
  type: CorpusPipelineJobType;
  idempotencyKey: string;
  dependencyKeys: string[];
  metadata: {
    corpusBookId: string;
    step: CorpusPipelineJobType;
    order: number;
    pipeline: "CORPUS_ANALYSIS";
  };
};

export type NextEligibleCorpusJobSelection = {
  job: PipelineJob | null;
  reason: string;
  inspectedJobCount: number;
};

export function corpusPipelineJobKey(
  corpusBookId: string,
  type: CorpusPipelineJobType
) {
  return `corpus:${corpusBookId}:pipeline-step:${type}`;
}

export function plannedCorpusPipelineJobs(
  corpusBookId: string
): PlannedCorpusPipelineJob[] {
  return CORPUS_PIPELINE_JOB_SEQUENCE.map((type, index) => ({
    type,
    idempotencyKey: corpusPipelineJobKey(corpusBookId, type),
    dependencyKeys:
      index === 0
        ? []
        : [corpusPipelineJobKey(corpusBookId, CORPUS_PIPELINE_JOB_SEQUENCE[index - 1])],
    metadata: {
      corpusBookId,
      step: type,
      order: index + 1,
      pipeline: "CORPUS_ANALYSIS" as const
    }
  }));
}

export function isCorpusPipelineJobType(
  type: string
): type is CorpusPipelineJobType {
  return CORPUS_PIPELINE_JOB_SEQUENCE.includes(type as CorpusPipelineJobType);
}

export function corpusPipelineJobWhere(
  corpusBookId: string
): Prisma.PipelineJobWhereInput {
  return {
    AND: [
      {
        metadata: {
          path: ["pipeline"],
          equals: CORPUS_ANALYSIS_PIPELINE_NAME
        }
      },
      {
        metadata: {
          path: ["corpusBookId"],
          equals: corpusBookId
        }
      }
    ]
  };
}

export function corpusPipelineJobTypeWhere(
  corpusBookId: string,
  type: CorpusPipelineJobType
): Prisma.PipelineJobWhereInput {
  return {
    AND: [
      corpusPipelineJobWhere(corpusBookId),
      {
        type
      }
    ]
  };
}

export async function ensureCorpusAnalysisJobs(corpusBookId: string) {
  const book = await prisma.corpusBook.findUnique({
    where: { id: corpusBookId },
    include: {
      text: true,
      profile: true,
      chunks: { select: { embeddingStatus: true } },
      _count: { select: { chapters: true, chunks: true } }
    }
  });

  if (!book) {
    throw new Error("Corpus book not found.");
  }

  const plans = plannedCorpusPipelineJobs(corpusBookId);
  const jobsByKey = new Map<string, PipelineJob>();
  const jobs: PipelineJob[] = [];
  const completedFromState = completedCorpusJobTypesFromState({
    fullTextAvailable: book.fullTextAvailable,
    cleanedText: book.text?.cleanedText ?? "",
    progress: normalizeProgress(book.importProgress),
    chapterCount: book._count.chapters,
    chunkCount: book._count.chunks,
    embeddingStatuses: book.chunks.map((chunk) => chunk.embeddingStatus),
    profileExists: Boolean(book.profile),
    benchmarkReady: book.benchmarkReady,
    benchmarkBlockedReason: book.benchmarkBlockedReason,
    analysisStatus: book.analysisStatus
  });

  for (const plan of plans) {
    const dependencyIds = plan.dependencyKeys
      .map((key) => jobsByKey.get(key)?.id)
      .filter((id): id is string => Boolean(id));
    const existing = await findExistingCorpusPipelineJob(corpusBookId, plan);
    const completed = completedFromState.has(plan.type);
    const baseData = {
      type: plan.type,
      manuscriptId: null,
      chapterId: null,
      dependencyIds: jsonInput(dependencyIds),
      metadata: jsonInput(plan.metadata),
      maxAttempts: maxAttemptsForCorpusJob(plan.type)
    };

    const job = existing
      ? await updateExistingCorpusPipelineJobIfNeeded(existing, baseData, completed)
      : await prisma.pipelineJob.create({
          data: {
            ...baseData,
            idempotencyKey: plan.idempotencyKey,
            status: completed
              ? PIPELINE_JOB_STATUS.COMPLETED
              : dependencyIds.length > 0
                ? PIPELINE_JOB_STATUS.BLOCKED
                : PIPELINE_JOB_STATUS.QUEUED,
            completedAt: completed ? new Date() : undefined
          }
        });

    jobsByKey.set(plan.idempotencyKey, job);
    jobs.push(job);
  }

  await unblockReadyCorpusJobs(corpusBookId);
  await updateCorpusPipelineStatus(corpusBookId);

  return {
    bookId: corpusBookId,
    jobs,
    summary: await getCorpusAnalysisSummary(corpusBookId)
  };
}

export async function findCorpusPipelineJobs(corpusBookId: string) {
  return prisma.pipelineJob.findMany({
    where: corpusPipelineJobWhere(corpusBookId),
    orderBy: { createdAt: "asc" }
  });
}

export async function getNextEligibleCorpusJob(corpusBookId: string) {
  const selection = await getNextEligibleCorpusJobSelection(corpusBookId);
  return selection.job;
}

export async function getNextEligibleCorpusJobSelection(
  corpusBookId: string
): Promise<NextEligibleCorpusJobSelection> {
  const now = new Date();
  const candidates = await prisma.pipelineJob.findMany({
    where: {
      AND: [
        corpusPipelineJobWhere(corpusBookId),
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
    orderBy: { createdAt: "asc" }
  });
  const skipped: string[] = [];

  for (const candidate of sortCorpusPipelineJobs(candidates)) {
    if (!canAttemptJob(candidate, now)) {
      skipped.push(`${candidate.type}:${candidate.id} is not ready or is locked`);
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
      skipped.push(`${candidate.type}:${candidate.id} exhausted retry attempts`);
      continue;
    }

    if (!(await corpusJobDependenciesComplete(candidate))) {
      if (candidate.status !== PIPELINE_JOB_STATUS.BLOCKED) {
        await prisma.pipelineJob.update({
          where: { id: candidate.id },
          data: { status: PIPELINE_JOB_STATUS.BLOCKED }
        });
      }
      skipped.push(`${candidate.type}:${candidate.id} is waiting on dependencies`);
      continue;
    }

    if (candidate.status === PIPELINE_JOB_STATUS.BLOCKED) {
      const job = await prisma.pipelineJob.update({
        where: { id: candidate.id },
        data: { status: PIPELINE_JOB_STATUS.QUEUED }
      });
      return {
        job,
        inspectedJobCount: candidates.length,
        reason: `Selected ${job.type}:${job.id} after unblocking completed dependencies.`
      };
    }

    return {
      job: candidate,
      inspectedJobCount: candidates.length,
      reason: `Selected ${candidate.type}:${candidate.id} as the next eligible corpus job.`
    };
  }

  return {
    job: null,
    inspectedJobCount: candidates.length,
    reason:
      skipped.length > 0
        ? `No eligible corpus job selected. ${skipped.join("; ")}.`
        : "No queued, retrying, or dependency-ready blocked corpus jobs were found."
  };
}

export async function findNextReadyCorpusJob(corpusBookId: string) {
  return getNextEligibleCorpusJob(corpusBookId);
}

export async function unblockReadyCorpusJobs(corpusBookId: string) {
  const candidates = await prisma.pipelineJob.findMany({
    where: {
      ...corpusPipelineJobWhere(corpusBookId),
      status: PIPELINE_JOB_STATUS.BLOCKED
    },
    orderBy: { createdAt: "asc" }
  });
  const readyJobIds: string[] = [];

  for (const candidate of sortCorpusPipelineJobs(candidates)) {
    if (await corpusJobDependenciesComplete(candidate)) {
      const updated = await prisma.pipelineJob.update({
        where: { id: candidate.id },
        data: { status: PIPELINE_JOB_STATUS.QUEUED }
      });
      readyJobIds.push(updated.id);
    }
  }

  return readyJobIds;
}

export async function updateCorpusPipelineStatus(corpusBookId: string) {
  const jobs = await findCorpusPipelineJobs(corpusBookId);

  if (jobs.length === 0) {
    return;
  }

  const allCompleted = jobs.every(
    (job) => job.status === PIPELINE_JOB_STATUS.COMPLETED
  );
  const anyFailed = jobs.some((job) => job.status === PIPELINE_JOB_STATUS.FAILED);

  if (anyFailed) {
    await prisma.corpusBook.update({
      where: { id: corpusBookId },
      data: { analysisStatus: CorpusAnalysisStatus.FAILED }
    });
    return;
  }

  if (allCompleted) {
    await prisma.corpusBook.update({
      where: { id: corpusBookId },
      data: { analysisStatus: CorpusAnalysisStatus.COMPLETED }
    });
    return;
  }

  await prisma.corpusBook.update({
    where: { id: corpusBookId },
    data: { analysisStatus: CorpusAnalysisStatus.RUNNING }
  });
}

export async function retryFailedCorpusPipelineJobs(corpusBookId: string) {
  const jobs = await findCorpusPipelineJobs(corpusBookId);
  const failedJobIds = jobs
    .filter((job) => job.status === PIPELINE_JOB_STATUS.FAILED)
    .map((job) => job.id);

  if (failedJobIds.length === 0) {
    return { retriedJobCount: 0 };
  }

  await prisma.pipelineJob.updateMany({
    where: { id: { in: failedJobIds } },
    data: {
      status: PIPELINE_JOB_STATUS.RETRYING,
      attempts: 0,
      error: null,
      readyAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null
    }
  });
  await updateCorpusPipelineStatus(corpusBookId);

  return { retriedJobCount: failedJobIds.length };
}

export async function releaseStaleCorpusJobLocks(
  corpusBookId: string,
  now: Date = new Date()
) {
  const jobs = await findCorpusPipelineJobs(corpusBookId);
  const staleJobs = jobs.filter(
    (job) =>
      job.status === PIPELINE_JOB_STATUS.RUNNING &&
      job.lockExpiresAt &&
      job.lockExpiresAt.getTime() <= now.getTime()
  );

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
        readyAt: status === PIPELINE_JOB_STATUS.RETRYING ? now : null,
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null
      }
    });
  }

  if (staleJobs.length > 0) {
    await updateCorpusPipelineStatus(corpusBookId);
  }

  return { releasedJobCount: staleJobs.length };
}

export async function queueCorpusBenchmarkReadinessCheck(corpusBookId: string) {
  const existing = await findExistingCorpusPipelineJob(corpusBookId, {
    type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_BENCHMARK_CHECK,
    idempotencyKey: corpusPipelineJobKey(
      corpusBookId,
      CORPUS_PIPELINE_JOB_TYPES.CORPUS_BENCHMARK_CHECK
    ),
    dependencyKeys: [],
    metadata: {
      corpusBookId,
      step: CORPUS_PIPELINE_JOB_TYPES.CORPUS_BENCHMARK_CHECK,
      order: CORPUS_PIPELINE_JOB_SEQUENCE.length,
      pipeline: CORPUS_ANALYSIS_PIPELINE_NAME
    }
  });

  await prisma.corpusBook.update({
    where: { id: corpusBookId },
    data: {
      analysisStatus: CorpusAnalysisStatus.RUNNING,
      benchmarkReady: false,
      benchmarkReadyAt: null,
      benchmarkBlockedReason: null
    }
  });

  if (!existing) {
    return { queuedBenchmarkCheck: false };
  }

  await prisma.pipelineJob.update({
    where: { id: existing.id },
    data: {
      status: PIPELINE_JOB_STATUS.RETRYING,
      attempts: 0,
      error: null,
      readyAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
      completedAt: null
    }
  });

  return { queuedBenchmarkCheck: true };
}

async function findExistingCorpusPipelineJob(
  corpusBookId: string,
  plan: PlannedCorpusPipelineJob
) {
  return prisma.pipelineJob.findFirst({
    where: {
      OR: [
        {
          idempotencyKey: plan.idempotencyKey
        },
        corpusPipelineJobTypeWhere(corpusBookId, plan.type)
      ]
    },
    orderBy: { createdAt: "asc" }
  });
}

async function updateExistingCorpusPipelineJobIfNeeded(
  existing: PipelineJob,
  baseData: {
    type: CorpusPipelineJobType;
    manuscriptId: null;
    chapterId: null;
    dependencyIds: Prisma.InputJsonValue;
    metadata: Prisma.InputJsonValue;
    maxAttempts: number;
  },
  completedFromState: boolean
) {
  const completedData = completedFromState
    ? {
        status: PIPELINE_JOB_STATUS.COMPLETED,
        completedAt: existing.completedAt ?? new Date(),
        error: null,
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null
      }
    : {};
  const updateData = {
    ...baseData,
    ...completedData
  };

  if (!shouldUpdateExistingCorpusPipelineJob(existing, updateData)) {
    return existing;
  }

  return prisma.pipelineJob.update({
    where: { id: existing.id },
    data: updateData
  });
}

function shouldUpdateExistingCorpusPipelineJob(
  existing: PipelineJob,
  next: {
    type: CorpusPipelineJobType;
    manuscriptId: null;
    chapterId: null;
    dependencyIds: Prisma.InputJsonValue;
    metadata: Prisma.InputJsonValue;
    maxAttempts: number;
    status?: string;
    completedAt?: Date;
    error?: null;
    lockedAt?: null;
    lockedBy?: null;
    lockExpiresAt?: null;
  }
) {
  if (
    existing.type !== next.type ||
    existing.manuscriptId !== next.manuscriptId ||
    existing.chapterId !== next.chapterId ||
    existing.maxAttempts !== next.maxAttempts ||
    !jsonValuesEqual(existing.dependencyIds, next.dependencyIds) ||
    !jsonValuesEqual(existing.metadata, next.metadata)
  ) {
    return true;
  }

  if (!next.status) {
    return false;
  }

  return (
    existing.status !== next.status ||
    !existing.completedAt ||
    existing.error !== next.error ||
    existing.lockedAt !== next.lockedAt ||
    existing.lockedBy !== next.lockedBy ||
    existing.lockExpiresAt !== next.lockExpiresAt
  );
}

export async function runCorpusPipelineJobStep(job: PipelineJob) {
  const corpusBookId = corpusBookIdFromPipelineJob(job);
  if (!corpusBookId) {
    throw new Error("Corpus pipeline job is missing corpusBookId metadata.");
  }

  switch (job.type) {
    case CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN:
      return cleanCorpusBook(corpusBookId);
    case CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS:
      return detectCorpusChapters(corpusBookId);
    case CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHUNK:
      return chunkCorpusBook(corpusBookId);
    case CORPUS_PIPELINE_JOB_TYPES.CORPUS_EMBED:
      return embedCorpusChunks(corpusBookId);
    case CORPUS_PIPELINE_JOB_TYPES.CORPUS_PROFILE:
      return profileCorpusBook(corpusBookId);
    case CORPUS_PIPELINE_JOB_TYPES.CORPUS_BENCHMARK_CHECK:
      return checkCorpusBenchmarkReadiness(corpusBookId);
    default:
      throw new Error(`Unknown corpus pipeline job type: ${job.type}`);
  }
}

export function corpusBookIdFromPipelineJob(job: Pick<PipelineJob, "metadata" | "idempotencyKey">) {
  const metadata = toJsonRecord(job.metadata);
  const metadataId = stringOrUndefined(metadata.corpusBookId);
  if (metadataId) {
    return metadataId;
  }

  const match = /^corpus:([^:]+):pipeline-step:/.exec(job.idempotencyKey);
  return match?.[1] ?? null;
}

export async function getCorpusAnalysisSummary(
  corpusBookId: string
): Promise<CorpusAnalysisSummary> {
  const book = await prisma.corpusBook.findUnique({
    where: { id: corpusBookId },
    include: {
      profile: { select: { id: true } },
      chunks: { select: { embeddingStatus: true } },
      importJobs: {
        orderBy: { createdAt: "desc" },
        take: 1
      },
      _count: { select: { chapters: true, chunks: true } }
    }
  });

  if (!book) {
    throw new Error("Corpus book not found.");
  }

  const jobs = await findCorpusPipelineJobs(corpusBookId);
  return summarizeCorpusAnalysis({
    book: {
      id: book.id,
      fullTextAvailable: book.fullTextAvailable,
      ingestionStatus: book.ingestionStatus,
      analysisStatus: book.analysisStatus,
      benchmarkReady: book.benchmarkReady,
      benchmarkBlockedReason: book.benchmarkBlockedReason,
      importProgress: book.importProgress
    },
    jobs: jobs.map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      error: job.error
    })),
    profileExists: Boolean(book.profile),
    chapterCount: book._count.chapters,
    chunkCount: book._count.chunks,
    embeddingStatuses: book.chunks.map((chunk) => chunk.embeddingStatus),
    latestImportStep: book.importJobs[0]?.currentStep ?? null
  });
}

export function summarizeCorpusAnalysis(input: {
  book: {
    id: string;
    fullTextAvailable: boolean;
    ingestionStatus: string;
    analysisStatus: string;
    benchmarkReady: boolean;
    benchmarkBlockedReason?: string | null;
    importProgress?: unknown;
  };
  jobs: Array<{
    id: string;
    type: string;
    status: string;
    error?: string | null;
  }>;
  profileExists: boolean;
  chapterCount: number;
  chunkCount: number;
  embeddingStatuses: string[];
  latestImportStep?: string | null;
}): CorpusAnalysisSummary {
  const progress = normalizeProgress(input.book.importProgress);
  const jobsByType = new Map(input.jobs.map((job) => [job.type, job]));
  const readyStatuses = new Set<string>([
    PIPELINE_JOB_STATUS.QUEUED,
    PIPELINE_JOB_STATUS.RETRYING
  ]);
  const unfinishedStatuses = new Set<string>([
    PIPELINE_JOB_STATUS.QUEUED,
    PIPELINE_JOB_STATUS.RUNNING,
    PIPELINE_JOB_STATUS.RETRYING,
    PIPELINE_JOB_STATUS.BLOCKED
  ]);
  const readyJobCount = input.jobs.filter((job) =>
    readyStatuses.has(job.status)
  ).length;
  const runningJobCount = input.jobs.filter(
    (job) => job.status === PIPELINE_JOB_STATUS.RUNNING
  ).length;
  const unfinishedJobCount = input.jobs.filter((job) =>
    unfinishedStatuses.has(job.status)
  ).length;
  const benchmarkReason =
    input.book.benchmarkBlockedReason ??
    progress.benchmarkBlockedReason ??
    null;

  const embeddingsDone = input.embeddingStatuses.length > 0
    ? input.embeddingStatuses.every((status) =>
        ["STORED", "SKIPPED", "EMPTY"].includes(status)
      )
    : progress.embeddingsCreated;
  const embeddingsSkipped =
    input.embeddingStatuses.length > 0 &&
    input.embeddingStatuses.every((status) => status === "SKIPPED");

  return {
    bookId: input.book.id,
    ingestionStatus: input.book.ingestionStatus,
    analysisStatus: input.book.analysisStatus,
    benchmarkReady: input.book.benchmarkReady,
    benchmarkBlockedReason: benchmarkReason,
    readyJobCount,
    runningJobCount,
    unfinishedJobCount,
    jobCount: input.jobs.length,
    jobs: input.jobs.map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      error: job.error ?? null
    })),
    steps: {
      imported: {
        label: "Imported",
        status:
          input.book.fullTextAvailable ||
          input.book.ingestionStatus !== CorpusIngestionStatus.QUEUED
            ? "done"
            : "queued",
        statusLabel:
          input.book.ingestionStatus === CorpusIngestionStatus.METADATA_ONLY
            ? "Metadata only"
            : "Imported",
        detail: input.latestImportStep
      },
      cleaning: stepSummary(
        "Cleaning",
        jobsByType.get(CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN),
        progress.cleaned
      ),
      chapters: stepSummary(
        "Chapters",
        jobsByType.get(CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS),
        progress.chaptersDetected || input.chapterCount > 0
      ),
      chunks: stepSummary(
        "Chunks",
        jobsByType.get(CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHUNK),
        progress.chunksCreated || input.chunkCount > 0
      ),
      embeddings: stepSummary(
        "Embeddings",
        jobsByType.get(CORPUS_PIPELINE_JOB_TYPES.CORPUS_EMBED),
        embeddingsDone,
        embeddingsSkipped ? "skipped" : undefined,
        progress.embeddingStatus
      ),
      bookDna: stepSummary(
        "Book DNA",
        jobsByType.get(CORPUS_PIPELINE_JOB_TYPES.CORPUS_PROFILE),
        progress.bookDnaExtracted || input.profileExists
      ),
      benchmark: {
        ...stepSummary(
          "Benchmark ready",
          jobsByType.get(CORPUS_PIPELINE_JOB_TYPES.CORPUS_BENCHMARK_CHECK),
          input.book.benchmarkReady,
          !input.book.benchmarkReady && benchmarkReason ? "blocked" : undefined,
          benchmarkReason
        ),
        ready: input.book.benchmarkReady,
        blockingReason: benchmarkReason
      }
    }
  };
}

export function shouldShowCorpusAnalysisAction(input: {
  analysisStatus: string;
  summary: CorpusAnalysisSummary;
}) {
  return (
    input.analysisStatus === CorpusAnalysisStatus.NOT_STARTED ||
    input.summary.unfinishedJobCount > 0 ||
    input.summary.steps.bookDna.status !== "done"
  );
}

async function cleanCorpusBook(corpusBookId: string) {
  const importJob = await findOrCreateImportJob(corpusBookId);
  const book = await prisma.corpusBook.findUnique({
    where: { id: corpusBookId },
    include: { source: true, text: true }
  });

  if (!book) {
    throw new Error("Corpus book not found.");
  }

  const progress = normalizeProgress(book.importProgress);
  progress.uploaded = true;

  if (!FULL_TEXT_RIGHTS.has(book.rightsStatus)) {
    progress.textExtracted = false;
    progress.cleaned = false;
    progress.benchmarkReady = false;
    progress.benchmarkBlockedReason =
      "Rights status does not permit full-text corpus processing.";
    await markImportStep(corpusBookId, importJob.id, "metadata_only", progress, "RUNNING", {
      fullTextAvailable: false,
      ingestionStatus: CorpusIngestionStatus.METADATA_ONLY,
      analysisStatus: CorpusAnalysisStatus.RUNNING,
      benchmarkReady: false,
      benchmarkReadyAt: null,
      benchmarkBlockedReason: progress.benchmarkBlockedReason
    });
    return { skipped: true, reason: progress.benchmarkBlockedReason };
  }

  if (!book.text) {
    progress.textExtracted = false;
    progress.cleaned = false;
    progress.benchmarkReady = false;
    progress.benchmarkBlockedReason = "No full text is available for this corpus book.";
    await markImportStep(corpusBookId, importJob.id, "metadata_only", progress, "RUNNING", {
      fullTextAvailable: false,
      ingestionStatus: CorpusIngestionStatus.METADATA_ONLY,
      analysisStatus: CorpusAnalysisStatus.RUNNING,
      benchmarkReady: false,
      benchmarkReadyAt: null,
      benchmarkBlockedReason: progress.benchmarkBlockedReason
    });
    return { skipped: true, reason: progress.benchmarkBlockedReason };
  }

  const cleanedText = cleanedCorpusText({
    rawText: book.text.rawText,
    cleanedText: book.text.cleanedText,
    sourceType: book.source.type
  });
  const wordCount = countWords(cleanedText);

  if (cleanedText !== book.text.cleanedText || wordCount !== book.text.wordCount) {
    await prisma.corpusBookText.update({
      where: { bookId: corpusBookId },
      data: {
        cleanedText,
        wordCount,
        cleanedAt: new Date()
      }
    });
  }

  progress.textExtracted = Boolean(cleanedText);
  progress.cleaned = Boolean(cleanedText);
  progress.benchmarkBlockedReason = null;
  await markImportStep(corpusBookId, importJob.id, "cleaned", progress, "RUNNING", {
    fullTextAvailable: Boolean(cleanedText),
    ingestionStatus: cleanedText
      ? CorpusIngestionStatus.IMPORTED
      : CorpusIngestionStatus.METADATA_ONLY,
    analysisStatus: CorpusAnalysisStatus.RUNNING,
    benchmarkReady: false,
    benchmarkReadyAt: null,
    benchmarkBlockedReason: null
  });

  return {
    cleaned: Boolean(cleanedText),
    wordCount
  };
}

async function detectCorpusChapters(corpusBookId: string) {
  const importJob = await findOrCreateImportJob(corpusBookId);
  const book = await prisma.corpusBook.findUnique({
    where: { id: corpusBookId },
    include: {
      text: true,
      chapters: { orderBy: { order: "asc" } }
    }
  });

  if (!book) {
    throw new Error("Corpus book not found.");
  }

  const progress = normalizeProgress(book.importProgress);
  if (!book.text?.cleanedText) {
    progress.chaptersDetected = false;
    await markImportStep(corpusBookId, importJob.id, "chapters_skipped", progress, "RUNNING");
    return { skipped: true, reason: "No cleaned text is available." };
  }

  const parsed = parseCorpusBook(book.text.cleanedText, book.fileName, book.title);
  if (book.chapters.length === 0) {
    await createCorpusChapters(corpusBookId, parsed);
  }

  const chapterCount = await prisma.corpusChapter.count({
    where: { bookId: corpusBookId }
  });
  progress.chaptersDetected = chapterCount > 0;
  await markImportStep(corpusBookId, importJob.id, "chapters_detected", progress, "RUNNING", {
    ingestionStatus: CorpusIngestionStatus.IMPORTED,
    analysisStatus: CorpusAnalysisStatus.RUNNING
  });

  return { chapterCount };
}

async function chunkCorpusBook(corpusBookId: string) {
  const importJob = await findOrCreateImportJob(corpusBookId);
  const book = await prisma.corpusBook.findUnique({
    where: { id: corpusBookId },
    include: {
      text: true,
      chunks: true,
      chapters: { orderBy: { order: "asc" } }
    }
  });

  if (!book) {
    throw new Error("Corpus book not found.");
  }

  const progress = normalizeProgress(book.importProgress);
  if (!book.text?.cleanedText) {
    progress.chunksCreated = false;
    await markImportStep(corpusBookId, importJob.id, "chunks_skipped", progress, "RUNNING");
    return { skipped: true, reason: "No cleaned text is available." };
  }

  const parsed = parseCorpusBook(book.text.cleanedText, book.fileName, book.title);
  if (book.chapters.length === 0) {
    await createCorpusChapters(corpusBookId, parsed);
  }

  if (book.chunks.length === 0) {
    const chapters = await prisma.corpusChapter.findMany({
      where: { bookId: corpusBookId },
      orderBy: { order: "asc" }
    });
    const chapterIdByOrder = new Map(
      chapters.map((chapter) => [chapter.order, chapter.id])
    );
    const chunks = chunkParsedManuscript(parsed);

    if (chunks.length > 0) {
      await prisma.corpusChunk.createMany({
        data: chunks.map((chunk) => ({
          bookId: corpusBookId,
          corpusChapterId: chapterIdByOrder.get(chunk.chapterOrder) ?? null,
          chapterIndex: chunk.chapterOrder,
          sectionIndex: chunk.sceneOrder,
          paragraphIndex: chunk.startParagraph,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          tokenCount: chunk.tokenEstimate,
          embeddingStatus: "PENDING",
          summary: truncateWords(chunk.text, 80),
          metrics: jsonInput({
            wordCount: chunk.wordCount,
            chapterTitle: chunk.metadata.chapterTitle,
            sceneTitle: chunk.metadata.sceneTitle,
            paragraphCount: chunk.metadata.paragraphCount
          })
        })),
        skipDuplicates: true
      });
    }
  }

  const chunkCount = await prisma.corpusChunk.count({
    where: { bookId: corpusBookId }
  });
  progress.chunksCreated = chunkCount > 0;
  await markImportStep(corpusBookId, importJob.id, "chunks_created", progress, "RUNNING", {
    ingestionStatus: CorpusIngestionStatus.CHUNKED,
    analysisStatus: CorpusAnalysisStatus.RUNNING
  });

  return { chunkCount };
}

async function embedCorpusChunks(corpusBookId: string) {
  const importJob = await findOrCreateImportJob(corpusBookId);
  const book = await prisma.corpusBook.findUnique({
    where: { id: corpusBookId },
    select: { importProgress: true }
  });

  if (!book) {
    throw new Error("Corpus book not found.");
  }

  const progress = normalizeProgress(book.importProgress);
  const embeddingStatus = await createEmbeddingsForCorpusChunks(corpusBookId);
  progress.embeddingsCreated = true;
  progress.embeddingStatus = embeddingStatus;
  await markImportStep(corpusBookId, importJob.id, "embeddings_created", progress, "RUNNING", {
    analysisStatus: CorpusAnalysisStatus.RUNNING
  });

  return { embeddingStatus };
}

async function profileCorpusBook(corpusBookId: string) {
  const importJob = await findOrCreateImportJob(corpusBookId);
  const book = await prisma.corpusBook.findUnique({
    where: { id: corpusBookId },
    include: { text: true, profile: true }
  });

  if (!book) {
    throw new Error("Corpus book not found.");
  }

  const progress = normalizeProgress(book.importProgress);
  if (!book.text?.cleanedText) {
    progress.bookDnaExtracted = false;
    await markImportStep(corpusBookId, importJob.id, "book_dna_skipped", progress, "RUNNING");
    return { skipped: true, reason: "No cleaned text is available." };
  }

  if (!book.profile) {
    const parsed = parseCorpusBook(book.text.cleanedText, book.fileName, book.title);
    const profile = calculateProfileMetrics(chaptersForProfile(parsed));
    await prisma.bookProfile.create({
      data: {
        bookId: corpusBookId,
        ...profileDataFromMetrics(profile)
      }
    });
  }

  progress.bookDnaExtracted = true;
  await markImportStep(corpusBookId, importJob.id, "book_dna_extracted", progress, "RUNNING", {
    ingestionStatus: CorpusIngestionStatus.PROFILED,
    analysisStatus: CorpusAnalysisStatus.RUNNING
  });

  return { profiled: true };
}

async function checkCorpusBenchmarkReadiness(corpusBookId: string) {
  const importJob = await findOrCreateImportJob(corpusBookId);
  const book = await prisma.corpusBook.findUnique({
    where: { id: corpusBookId },
    include: {
      profile: { select: { id: true } },
      _count: { select: { chunks: true } }
    }
  });

  if (!book) {
    throw new Error("Corpus book not found.");
  }

  const progress = normalizeProgress(book.importProgress);
  const blockedReason = corpusBenchmarkBlockedReason({
    rightsStatus: book.rightsStatus,
    allowedUses: book.allowedUses,
    benchmarkAllowed: book.benchmarkAllowed,
    profileExists: Boolean(book.profile),
    chunkCount: book._count.chunks
  });
  const benchmarkReady = blockedReason === null;

  progress.benchmarkReady = benchmarkReady;
  progress.benchmarkBlockedReason = blockedReason;

  const ingestionStatus = Boolean(book.profile)
    ? CorpusIngestionStatus.PROFILED
    : book.fullTextAvailable
      ? book.ingestionStatus
      : CorpusIngestionStatus.METADATA_ONLY;

  await prisma.corpusBook.update({
    where: { id: corpusBookId },
    data: {
      ingestionStatus,
      analysisStatus: CorpusAnalysisStatus.COMPLETED,
      benchmarkReady,
      benchmarkReadyAt: benchmarkReady ? new Date() : null,
      benchmarkBlockedReason: blockedReason,
      importProgress: jsonInput(progress)
    }
  });
  await completeImportJob(
    importJob.id,
    benchmarkReady ? "benchmark_ready" : "benchmark_blocked",
    progress
  );

  return {
    benchmarkReady,
    benchmarkBlockedReason: blockedReason
  };
}

async function createCorpusChapters(
  corpusBookId: string,
  parsed: ParsedManuscript
) {
  const profileChapters = chaptersForProfile(parsed);

  for (const chapter of parsed.chapters) {
    const chapterText =
      profileChapters[chapter.order - 1]?.text ??
      chapter.scenes
        .flatMap((scene) => scene.paragraphs.map((paragraph) => paragraph.text))
        .join("\n\n");

    await prisma.corpusChapter.create({
      data: {
        bookId: corpusBookId,
        order: chapter.order,
        chapterIndex: chapter.order,
        title: chapter.title,
        heading: chapter.heading,
        text: chapterText,
        wordCount: chapter.wordCount,
        startOffset: chapter.startOffset,
        endOffset: chapter.endOffset,
        metrics: jsonInput(chapterMetrics(chapterText))
      }
    });
  }
}

async function createEmbeddingsForCorpusChunks(corpusBookId: string) {
  const chunks = await prisma.corpusChunk.findMany({
    where: {
      bookId: corpusBookId,
      embeddingStatus: { in: ["PENDING", "FAILED"] }
    },
    orderBy: { chunkIndex: "asc" }
  });

  if (chunks.length === 0) {
    return "skipped: no pending chunks";
  }

  if (!hasEditorModelKey()) {
    await prisma.corpusChunk.updateMany({
      where: {
        bookId: corpusBookId,
        embeddingStatus: { in: ["PENDING", "FAILED"] }
      },
      data: {
        embeddingStatus: "SKIPPED"
      }
    });
    return "skipped: OPENAI_API_KEY not configured";
  }

  let stored = 0;
  for (const chunk of chunks) {
    try {
      const embedding = await createEmbedding(chunk.text);
      if (embedding.length > 0) {
        await storeCorpusChunkEmbedding(chunk.id, embedding);
        await prisma.corpusChunk.update({
          where: { id: chunk.id },
          data: { embeddingStatus: "STORED" }
        });
        stored += 1;
      } else {
        await prisma.corpusChunk.update({
          where: { id: chunk.id },
          data: { embeddingStatus: "EMPTY" }
        });
      }
    } catch {
      await prisma.corpusChunk.update({
        where: { id: chunk.id },
        data: { embeddingStatus: "FAILED" }
      });
    }
  }

  return `stored ${stored}/${chunks.length}`;
}

async function storeCorpusChunkEmbedding(chunkId: string, embedding: number[]) {
  const vectorLiteral = `[${embedding.join(",")}]`;
  await prisma.$executeRawUnsafe(
    'UPDATE "CorpusChunk" SET "embedding" = $1::vector WHERE "id" = $2',
    vectorLiteral,
    chunkId
  );
}

async function findOrCreateImportJob(bookId: string) {
  const existing = await prisma.corpusImportJob.findFirst({
    where: {
      bookId,
      status: { in: ["QUEUED", "RUNNING", "FAILED"] }
    },
    orderBy: { createdAt: "desc" }
  });

  if (existing) {
    return existing;
  }

  return prisma.corpusImportJob.create({
    data: {
      bookId,
      status: "QUEUED",
      currentStep: "uploaded",
      progress: jsonInput(normalizeProgress(undefined))
    }
  });
}

async function markImportStep(
  bookId: string,
  jobId: string,
  currentStep: string,
  progress: ImportProgress,
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED",
  bookData: Prisma.CorpusBookUpdateInput = {}
) {
  await prisma.$transaction([
    prisma.corpusBook.update({
      where: { id: bookId },
      data: {
        ...bookData,
        importProgress: jsonInput(progress)
      }
    }),
    prisma.corpusImportJob.update({
      where: { id: jobId },
      data: {
        status,
        currentStep,
        progress: jsonInput(progress),
        startedAt: status === "RUNNING" ? new Date() : undefined
      }
    })
  ]);
}

async function completeImportJob(
  jobId: string,
  currentStep: string,
  progress: ImportProgress
) {
  await prisma.corpusImportJob.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      currentStep,
      progress: jsonInput(progress),
      completedAt: new Date()
    }
  });
}

async function corpusJobDependenciesComplete(job: PipelineJob) {
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

function completedCorpusJobTypesFromState(input: {
  fullTextAvailable: boolean;
  cleanedText: string;
  progress: ImportProgress;
  chapterCount: number;
  chunkCount: number;
  embeddingStatuses: string[];
  profileExists: boolean;
  benchmarkReady: boolean;
  benchmarkBlockedReason?: string | null;
  analysisStatus: string;
}) {
  const completed = new Set<CorpusPipelineJobType>();

  if (input.fullTextAvailable && input.cleanedText.trim() && input.progress.cleaned) {
    completed.add(CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN);
  }

  if (input.chapterCount > 0 || input.progress.chaptersDetected) {
    completed.add(CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS);
  }

  if (input.chunkCount > 0 || input.progress.chunksCreated) {
    completed.add(CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHUNK);
  }

  if (
    input.progress.embeddingsCreated ||
    (input.embeddingStatuses.length > 0 &&
      input.embeddingStatuses.every((status) =>
        ["STORED", "SKIPPED", "EMPTY"].includes(status)
      ))
  ) {
    completed.add(CORPUS_PIPELINE_JOB_TYPES.CORPUS_EMBED);
  }

  if (input.profileExists || input.progress.bookDnaExtracted) {
    completed.add(CORPUS_PIPELINE_JOB_TYPES.CORPUS_PROFILE);
  }

  if (
    input.benchmarkReady ||
    Boolean(input.benchmarkBlockedReason) ||
    input.analysisStatus === CorpusAnalysisStatus.COMPLETED
  ) {
    completed.add(CORPUS_PIPELINE_JOB_TYPES.CORPUS_BENCHMARK_CHECK);
  }

  return completed;
}

function stepSummary(
  label: string,
  job: { status: string; error?: string | null } | undefined,
  completedFromState: boolean,
  overrideStatus?: CorpusAnalysisStepState,
  detail?: string | null
): CorpusAnalysisStepSummary {
  const status = overrideStatus ?? stepStateFromJob(job, completedFromState);
  return {
    label,
    status,
    statusLabel: stepStateLabel(status),
    detail: detail ?? job?.error ?? null
  };
}

function stepStateFromJob(
  job: { status: string } | undefined,
  completedFromState: boolean
): CorpusAnalysisStepState {
  if (completedFromState || job?.status === PIPELINE_JOB_STATUS.COMPLETED) {
    return "done";
  }

  if (!job) {
    return "not_started";
  }

  if (job.status === PIPELINE_JOB_STATUS.RUNNING) {
    return "running";
  }

  if (job.status === PIPELINE_JOB_STATUS.FAILED) {
    return "failed";
  }

  if (job.status === PIPELINE_JOB_STATUS.BLOCKED) {
    return "queued";
  }

  if (
    job.status === PIPELINE_JOB_STATUS.QUEUED ||
    job.status === PIPELINE_JOB_STATUS.RETRYING
  ) {
    return "queued";
  }

  return "not_started";
}

function stepStateLabel(status: CorpusAnalysisStepState) {
  switch (status) {
    case "not_started":
      return "Not started";
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "blocked":
      return "Blocked";
    case "skipped":
      return "Skipped";
  }
}

function normalizeProgress(value: unknown): ImportProgress {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Partial<ImportProgress>)
    : {};

  return {
    uploaded: record.uploaded ?? true,
    textExtracted: record.textExtracted ?? false,
    cleaned: record.cleaned ?? false,
    chaptersDetected: record.chaptersDetected ?? false,
    chunksCreated: record.chunksCreated ?? false,
    embeddingsCreated: record.embeddingsCreated ?? false,
    bookDnaExtracted: record.bookDnaExtracted ?? false,
    benchmarkReady: record.benchmarkReady ?? false,
    embeddingStatus: record.embeddingStatus,
    benchmarkBlockedReason: record.benchmarkBlockedReason ?? null,
    error: record.error
  };
}

function cleanedCorpusText(input: {
  rawText: string;
  cleanedText: string;
  sourceType: string;
}) {
  const candidate = input.cleanedText.trim() ? input.cleanedText : input.rawText;
  return input.sourceType === "GUTENBERG"
    ? cleanGutenbergText(candidate)
    : normalizeWhitespace(candidate);
}

function parseCorpusBook(
  cleanedText: string,
  fileName: string | null,
  title: string
) {
  return parseManuscriptText(cleanedText, fileName ?? `${title}.txt`);
}

function maxAttemptsForCorpusJob(type: CorpusPipelineJobType) {
  return type === CORPUS_PIPELINE_JOB_TYPES.CORPUS_EMBED ? 2 : 3;
}

function sortCorpusPipelineJobs<T extends Pick<PipelineJob, "createdAt" | "metadata" | "type">>(
  jobs: T[]
) {
  return [...jobs].sort((a, b) => {
    const orderDelta = corpusJobOrder(a) - corpusJobOrder(b);
    if (orderDelta !== 0) {
      return orderDelta;
    }

    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

function corpusJobOrder(job: Pick<PipelineJob, "metadata" | "type">) {
  const metadataOrder = Number(toJsonRecord(job.metadata).order);
  if (Number.isFinite(metadataOrder)) {
    return metadataOrder;
  }

  const sequenceIndex = CORPUS_PIPELINE_JOB_SEQUENCE.indexOf(
    job.type as CorpusPipelineJobType
  );
  return sequenceIndex >= 0 ? sequenceIndex + 1 : Number.MAX_SAFE_INTEGER;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeJsonComparable(left)) ===
    JSON.stringify(normalizeJsonComparable(right));
}

function normalizeJsonComparable(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeJsonComparable);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, item]) => [key, normalizeJsonComparable(item)])
    );
  }

  return value ?? null;
}

function toJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
