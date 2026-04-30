import {
  areDependenciesComplete,
  canAttemptJob,
  dependencyIdsFromJson,
  isJobReadyAtSatisfied,
  isLockStale,
  PIPELINE_JOB_STATUS,
  type DependencySnapshot
} from "@/lib/pipeline/jobRules";

export const JOB_STALE_WARNING_SECONDS = 120;
export const CORPUS_PROGRESS_POLL_INTERVAL_MS = 2500;

export type CorpusProgressStepKey =
  | "imported"
  | "cleaning"
  | "chapters"
  | "chunks"
  | "embeddings"
  | "book_dna"
  | "benchmark_ready";

export type CorpusProgressStepStatus =
  | "done"
  | "running"
  | "queued"
  | "failed"
  | "skipped"
  | "blocked";

export type CorpusProgressStep = {
  key: CorpusProgressStepKey;
  label: string;
  status: CorpusProgressStepStatus;
  detail?: string | null;
  updatedAt?: string;
};

export type CorpusProgressCounts = {
  chapters: number;
  chunks: number;
  embeddedChunks: number;
  totalJobs: number;
  completedJobs: number;
  runningJobs: number;
  queuedJobs: number;
  failedJobs: number;
};

export type CorpusProgressStatus = {
  bookId: string;
  ingestionStatus: string;
  analysisStatus: string;
  benchmarkReady: boolean;
  benchmarkBlockedReason?: string | null;
  counts: CorpusProgressCounts;
  steps: CorpusProgressStep[];
  progress: {
    completedSteps: number;
    totalSteps: number;
    percent: number;
    currentStepLabel?: string;
    isActive: boolean;
    isBlocked: boolean;
    isFailed: boolean;
    isComplete: boolean;
  };
  latestJob?: {
    id: string;
    type: string;
    status: string;
    updatedAt: string;
    error?: string | null;
  };
  nextEligibleJob?: CorpusProgressNextEligibleJob;
  nextEligibleJobReason?: string;
  lastUpdatedAt: string;
};

export type CorpusProgressNextEligibleJob = {
  id: string;
  type: string;
  status: string;
  eligible: boolean;
  dependencyStatus: "none" | "complete" | "waiting" | "missing";
  dependencies: DependencySnapshot[];
  reason: string;
};

export type CorpusProgressRequestAction =
  | "start"
  | "retry_failed"
  | "resume"
  | "check_benchmark";

export type CorpusProgressAction =
  | {
      kind: "start" | "retry_failed" | "resume" | "check_benchmark";
      label: string;
      runningLabel: string;
      requestAction: CorpusProgressRequestAction;
      disabled: false;
    }
  | {
      kind: "running";
      label: string;
      runningLabel: string;
      disabled: true;
    }
  | {
      kind: "view_book_dna";
      label: string;
      href: string;
      disabled: false;
    };

export type CorpusProgressJobSnapshot = {
  id: string;
  type: string;
  status: string;
  createdAt?: Date | string;
  updatedAt: Date | string;
  error?: string | null;
  dependencyIds?: unknown;
  metadata?: unknown;
  readyAt?: Date | string | null;
  lockedAt?: Date | string | null;
  lockExpiresAt?: Date | string | null;
  attempts?: number;
  maxAttempts?: number;
};

export type CorpusProgressBuildInput = {
  book: {
    id: string;
    fullTextAvailable: boolean;
    ingestionStatus: string;
    analysisStatus: string;
    benchmarkReady: boolean;
    benchmarkBlockedReason?: string | null;
    benchmarkReadyAt?: Date | string | null;
    updatedAt: Date | string;
    importProgress?: unknown;
    textCleanedAt?: Date | string | null;
    latestImportStep?: string | null;
    latestImportUpdatedAt?: Date | string | null;
    latestImportError?: string | null;
    profileCreatedAt?: Date | string | null;
    profileExists: boolean;
  };
  counts: {
    chapters: number;
    chunks: number;
    embeddedChunks: number;
  };
  embeddingStatusCounts: Array<{
    status: string;
    count: number;
  }>;
  jobs: CorpusProgressJobSnapshot[];
};

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

const STEP_PERCENT: Record<CorpusProgressStepKey, number> = {
  imported: 10,
  cleaning: 25,
  chapters: 40,
  chunks: 55,
  embeddings: 70,
  book_dna: 90,
  benchmark_ready: 100
};

const COMPLETE_EMBEDDING_STATUSES = new Set(["STORED", "SKIPPED", "EMPTY"]);
const QUEUED_JOB_STATUSES = new Set(["QUEUED", "RETRYING", "BLOCKED"]);
const NEXT_JOB_CANDIDATE_STATUSES = new Set<string>([
  PIPELINE_JOB_STATUS.QUEUED,
  PIPELINE_JOB_STATUS.RETRYING,
  PIPELINE_JOB_STATUS.BLOCKED
]);
const ACTIVE_ANALYSIS_STATUSES = new Set(["QUEUED", "RUNNING", "RETRYING"]);
const CORPUS_JOB_TYPE_ORDER = new Map(
  [
    "CORPUS_CLEAN",
    "CORPUS_CHAPTERS",
    "CORPUS_CHUNK",
    "CORPUS_EMBED",
    "CORPUS_PROFILE",
    "CORPUS_BENCHMARK_CHECK"
  ].map((type, index) => [type, index + 1])
);

export function buildCorpusProgressStatus(
  input: CorpusProgressBuildInput
): CorpusProgressStatus {
  const progress = normalizeImportProgress(input.book.importProgress);
  const jobsByType = new Map(input.jobs.map((job) => [job.type, job]));
  const benchmarkBlockedReason =
    input.book.benchmarkBlockedReason ??
    progress.benchmarkBlockedReason ??
    null;
  const embeddingTotal = input.embeddingStatusCounts.reduce(
    (sum, item) => sum + item.count,
    0
  );
  const embeddingsDone =
    embeddingTotal > 0
      ? input.embeddingStatusCounts.every((item) =>
          COMPLETE_EMBEDDING_STATUSES.has(item.status)
        )
      : progress.embeddingsCreated;
  const embeddingsSkipped =
    (embeddingTotal > 0 &&
      input.embeddingStatusCounts.every((item) => item.status === "SKIPPED")) ||
    Boolean(progress.embeddingStatus?.toLowerCase().startsWith("skipped"));

  const steps: CorpusProgressStep[] = [
    {
      key: "imported",
      label: "Imported",
      status:
        input.book.ingestionStatus === "FAILED"
          ? "failed"
          : input.book.fullTextAvailable || input.book.ingestionStatus !== "QUEUED"
            ? "done"
            : "queued",
      detail:
        input.book.latestImportError ??
        input.book.latestImportStep ??
        (input.book.ingestionStatus === "METADATA_ONLY"
          ? "Metadata only"
          : input.book.fullTextAvailable
            ? "Full text available"
            : null),
      updatedAt: dateToIso(input.book.latestImportUpdatedAt ?? input.book.updatedAt)
    },
    stepFromJob({
      key: "cleaning",
      label: "Cleaning",
      job: jobsByType.get("CORPUS_CLEAN"),
      completedFromState:
        progress.cleaned ||
        Boolean(input.book.textCleanedAt) ||
        input.book.ingestionStatus === "CHUNKED" ||
        input.book.ingestionStatus === "PROFILED",
      detail: progress.cleaned ? "Cleaned text available" : null,
      fallbackUpdatedAt: input.book.textCleanedAt
    }),
    stepFromJob({
      key: "chapters",
      label: "Chapters",
      job: jobsByType.get("CORPUS_CHAPTERS"),
      completedFromState: progress.chaptersDetected || input.counts.chapters > 0,
      detail:
        input.counts.chapters > 0
          ? `${input.counts.chapters.toLocaleString()} chapters`
          : null
    }),
    stepFromJob({
      key: "chunks",
      label: "Chunks",
      job: jobsByType.get("CORPUS_CHUNK"),
      completedFromState: progress.chunksCreated || input.counts.chunks > 0,
      detail:
        input.counts.chunks > 0
          ? `${input.counts.chunks.toLocaleString()} chunks`
          : null
    }),
    stepFromJob({
      key: "embeddings",
      label: "Embeddings",
      job: jobsByType.get("CORPUS_EMBED"),
      completedFromState: embeddingsDone,
      overrideStatus: embeddingsDone && embeddingsSkipped ? "skipped" : undefined,
      detail:
        progress.embeddingStatus ??
        (input.counts.embeddedChunks > 0
          ? `${input.counts.embeddedChunks.toLocaleString()} embedded chunks`
          : null)
    }),
    stepFromJob({
      key: "book_dna",
      label: "Book DNA",
      job: jobsByType.get("CORPUS_PROFILE"),
      completedFromState: progress.bookDnaExtracted || input.book.profileExists,
      detail: input.book.profileExists ? "Profile created" : null,
      fallbackUpdatedAt: input.book.profileCreatedAt
    }),
    stepFromJob({
      key: "benchmark_ready",
      label: "Benchmark ready",
      job: jobsByType.get("CORPUS_BENCHMARK_CHECK"),
      completedFromState:
        input.book.benchmarkReady ||
        Boolean(benchmarkBlockedReason) ||
        input.book.analysisStatus === "COMPLETED",
      overrideStatus: input.book.benchmarkReady
        ? "done"
        : benchmarkBlockedReason
          ? "blocked"
          : undefined,
      detail: input.book.benchmarkReady
        ? "Benchmark is ready"
        : benchmarkBlockedReason,
      fallbackUpdatedAt: input.book.benchmarkReadyAt
    })
  ];

  const counts = jobCounts(input.jobs, input.counts);
  const latestJob = latestUpdatedJob(input.jobs);
  const nextEligibleJobSelection = describeNextEligibleCorpusJobSelection(input.jobs);
  const progressState = calculateCorpusProgress({
    analysisStatus: input.book.analysisStatus,
    benchmarkReady: input.book.benchmarkReady,
    counts,
    steps
  });
  const lastUpdatedAt = latestIso([
    input.book.updatedAt,
    input.book.benchmarkReadyAt,
    input.book.textCleanedAt,
    input.book.latestImportUpdatedAt,
    input.book.profileCreatedAt,
    ...input.jobs.map((job) => job.updatedAt)
  ]);

  return {
    bookId: input.book.id,
    ingestionStatus: input.book.ingestionStatus,
    analysisStatus: input.book.analysisStatus,
    benchmarkReady: input.book.benchmarkReady,
    benchmarkBlockedReason,
    counts,
    steps,
    progress: progressState,
    latestJob: latestJob
      ? {
          id: latestJob.id,
          type: latestJob.type,
          status: latestJob.status,
          updatedAt: dateToIso(latestJob.updatedAt) ?? lastUpdatedAt,
          error: latestJob.error ?? null
        }
      : undefined,
    nextEligibleJob: nextEligibleJobSelection.job,
    nextEligibleJobReason: nextEligibleJobSelection.reason,
    lastUpdatedAt
  };
}

export function describeNextEligibleCorpusJob(
  jobs: CorpusProgressJobSnapshot[],
  now: Date = new Date()
): CorpusProgressNextEligibleJob | undefined {
  return describeNextEligibleCorpusJobSelection(jobs, now).job;
}

export function describeNextEligibleCorpusJobSelection(
  jobs: CorpusProgressJobSnapshot[],
  now: Date = new Date()
): {
  job?: CorpusProgressNextEligibleJob;
  reason: string;
  inspectedJobCount: number;
} {
  const candidates = jobs.filter((job) =>
    NEXT_JOB_CANDIDATE_STATUSES.has(job.status)
  );
  const skipped: string[] = [];

  for (const job of sortCorpusProgressJobs(candidates)) {
    const dependencyIds = dependencyIdsFromJson(job.dependencyIds);
    const dependencies = dependencyIds.map((id) => ({
      id,
      status: jobs.find((candidate) => candidate.id === id)?.status ?? "MISSING"
    }));
    const dependencyStatus = summarizeDependencyStatus(
      dependencyIds,
      dependencies
    );
    const dependenciesComplete = areDependenciesComplete(
      dependencyIds,
      dependencies
    );
    const eligible =
      canAttemptJob(job, now) &&
      dependenciesComplete &&
      (job.status === PIPELINE_JOB_STATUS.QUEUED ||
        job.status === PIPELINE_JOB_STATUS.RETRYING ||
        job.status === PIPELINE_JOB_STATUS.BLOCKED);

    const described = {
      id: job.id,
      type: job.type,
      status: job.status,
      eligible,
      dependencyStatus,
      dependencies,
      reason: corpusJobReadinessReason({
        job,
        dependencies,
        dependenciesComplete,
        dependencyStatus,
        eligible,
        now
      })
    };

    if (eligible) {
      return {
        job: described,
        reason: described.reason,
        inspectedJobCount: candidates.length
      };
    }

    skipped.push(`${job.type}:${job.id} ${described.reason}`);
  }

  return {
    reason:
      skipped.length > 0
        ? `No eligible corpus job selected. ${skipped.join("; ")}`
        : "No queued, retrying, or blocked corpus jobs are currently eligible.",
    inspectedJobCount: candidates.length
  };
}

export function calculateCorpusProgress(input: {
  analysisStatus: string;
  benchmarkReady: boolean;
  counts: CorpusProgressCounts;
  steps: CorpusProgressStep[];
}): CorpusProgressStatus["progress"] {
  const isFailed =
    input.analysisStatus === "FAILED" ||
    input.counts.failedJobs > 0 ||
    input.steps.some((step) => step.status === "failed");
  const percent = input.steps.reduce((max, step) => {
    if (!isStepCompleteForProgress(step)) {
      return max;
    }

    return Math.max(max, STEP_PERCENT[step.key]);
  }, 0);
  const isComplete =
    !isFailed && (percent >= 100 || input.analysisStatus === "COMPLETED");
  const isActive =
    !isComplete &&
    !isFailed &&
    input.analysisStatus !== "CANCELLED" &&
    (input.counts.runningJobs > 0 || input.counts.queuedJobs > 0);
  const current =
    input.steps.find((step) => step.status === "running") ??
    input.steps.find((step) => step.status === "failed") ??
    input.steps.find((step) => step.status === "queued") ??
    input.steps.find((step) => step.status === "blocked");

  return {
    completedSteps: input.steps.filter(isStepCompleteForProgress).length,
    totalSteps: input.steps.length,
    percent,
    currentStepLabel: current?.label,
    isActive,
    isBlocked: input.steps.some((step) => step.status === "blocked"),
    isFailed,
    isComplete
  };
}

function sortCorpusProgressJobs(jobs: CorpusProgressJobSnapshot[]) {
  return [...jobs].sort((a, b) => {
    const orderDelta = corpusProgressJobOrder(a) - corpusProgressJobOrder(b);
    if (orderDelta !== 0) {
      return orderDelta;
    }

    return dateMillis(a.createdAt ?? a.updatedAt) - dateMillis(b.createdAt ?? b.updatedAt);
  });
}

function corpusProgressJobOrder(job: CorpusProgressJobSnapshot) {
  const metadataOrder = Number(toJsonRecord(job.metadata).order);
  if (Number.isFinite(metadataOrder)) {
    return metadataOrder;
  }

  return CORPUS_JOB_TYPE_ORDER.get(job.type) ?? Number.MAX_SAFE_INTEGER;
}

function summarizeDependencyStatus(
  dependencyIds: string[],
  dependencies: DependencySnapshot[]
): CorpusProgressNextEligibleJob["dependencyStatus"] {
  if (dependencyIds.length === 0) {
    return "none";
  }

  if (dependencies.some((dependency) => dependency.status === "MISSING")) {
    return "missing";
  }

  return areDependenciesComplete(dependencyIds, dependencies)
    ? "complete"
    : "waiting";
}

function corpusJobReadinessReason(input: {
  job: CorpusProgressJobSnapshot;
  dependencies: DependencySnapshot[];
  dependenciesComplete: boolean;
  dependencyStatus: CorpusProgressNextEligibleJob["dependencyStatus"];
  eligible: boolean;
  now: Date;
}) {
  if (
    input.job.status === PIPELINE_JOB_STATUS.RETRYING &&
    input.job.attempts !== undefined &&
    input.job.maxAttempts !== undefined &&
    input.job.attempts >= input.job.maxAttempts
  ) {
    return "Retry attempts are exhausted; the job will be marked failed.";
  }

  if (!input.dependenciesComplete) {
    const waiting = input.dependencies
      .filter((dependency) => dependency.status !== PIPELINE_JOB_STATUS.COMPLETED)
      .map((dependency) => `${dependency.id}:${dependency.status}`)
      .join(", ");
    return input.dependencyStatus === "missing"
      ? `Blocked because dependency rows are missing: ${waiting}.`
      : `Blocked until dependencies complete: ${waiting}.`;
  }

  if (!isJobReadyAtSatisfied(input.job, input.now)) {
    return `Waiting until readyAt ${dateToIso(input.job.readyAt) ?? "is reached"}.`;
  }

  if (input.job.lockedAt && !isLockStale(input.job, input.now)) {
    return `Locked until ${dateToIso(input.job.lockExpiresAt) ?? "the lock expires"}.`;
  }

  if (input.eligible && input.job.status === PIPELINE_JOB_STATUS.BLOCKED) {
    return "Dependencies are complete; the blocked job can be queued and run.";
  }

  if (input.eligible) {
    return "Eligible: dependencies are complete, readyAt is satisfied, and no active lock exists.";
  }

  return "Not eligible for execution yet.";
}

export function shouldPollCorpusStatus(status: CorpusProgressStatus) {
  if (
    status.progress.isComplete ||
    status.progress.isFailed ||
    status.analysisStatus === "CANCELLED"
  ) {
    return false;
  }

  const hasQueuedOrRunning =
    status.counts.runningJobs > 0 || status.counts.queuedJobs > 0;

  if (!hasQueuedOrRunning) {
    return false;
  }

  if (ACTIVE_ANALYSIS_STATUSES.has(status.analysisStatus)) {
    return true;
  }

  if (
    (status.analysisStatus === "IMPORTED" ||
      status.ingestionStatus === "IMPORTED") &&
    status.counts.queuedJobs > 0
  ) {
    return true;
  }

  return !status.benchmarkReady;
}

export function isCorpusProgressStale(
  status: CorpusProgressStatus,
  now: Date = new Date()
) {
  if (status.analysisStatus !== "RUNNING" || !status.latestJob) {
    return false;
  }

  const lastJobUpdate = new Date(status.latestJob.updatedAt).getTime();
  if (!Number.isFinite(lastJobUpdate)) {
    return false;
  }

  return now.getTime() - lastJobUpdate > JOB_STALE_WARNING_SECONDS * 1000;
}

export function staleWarningText(
  status: CorpusProgressStatus,
  now: Date = new Date()
) {
  if (!isCorpusProgressStale(status, now) || !status.latestJob) {
    return null;
  }

  return `Analysis may be stuck. Last job update was ${formatRelativeAge(
    status.latestJob.updatedAt,
    now
  )} ago.`;
}

export function getCorpusProgressAction(
  status: CorpusProgressStatus,
  now: Date = new Date()
): CorpusProgressAction {
  if (status.progress.isFailed || status.counts.failedJobs > 0) {
    return {
      kind: "retry_failed",
      label: "Retry failed jobs",
      runningLabel: "Retrying...",
      requestAction: "retry_failed",
      disabled: false
    };
  }

  if (isCorpusProgressStale(status, now)) {
    return {
      kind: "resume",
      label: "Resume analysis",
      runningLabel: "Resuming...",
      requestAction: "resume",
      disabled: false
    };
  }

  if (status.progress.isComplete || status.analysisStatus === "COMPLETED") {
    if (status.benchmarkReady) {
      return {
        kind: "view_book_dna",
        label: "View Book DNA",
        href: `/admin/corpus/${status.bookId}/profile`,
        disabled: false
      };
    }

    return {
      kind: "check_benchmark",
      label: "Check benchmark readiness",
      runningLabel: "Checking...",
      requestAction: "check_benchmark",
      disabled: false
    };
  }

  if (
    status.progress.isActive ||
    ACTIVE_ANALYSIS_STATUSES.has(status.analysisStatus)
  ) {
    return {
      kind: "running",
      label: "Running...",
      runningLabel: "Running...",
      disabled: true
    };
  }

  return {
    kind: "start",
    label: "Start analysis",
    runningLabel: "Starting analysis...",
    requestAction: "start",
    disabled: false
  };
}

export function formatRelativeAge(
  isoDate: string,
  now: Date = new Date()
) {
  const timestamp = new Date(isoDate).getTime();
  if (!Number.isFinite(timestamp)) {
    return "unknown";
  }

  const seconds = Math.max(0, Math.floor((now.getTime() - timestamp) / 1000));
  if (seconds < 60) {
    return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function stepFromJob(input: {
  key: CorpusProgressStepKey;
  label: string;
  job?: CorpusProgressJobSnapshot;
  completedFromState: boolean;
  overrideStatus?: CorpusProgressStepStatus;
  detail?: string | null;
  fallbackUpdatedAt?: Date | string | null;
}): CorpusProgressStep {
  const status =
    input.overrideStatus ??
    stepStatusFromJob(input.job, input.completedFromState);
  const failedDetail =
    status === "failed" ? input.job?.error ?? "Job failed" : null;

  return {
    key: input.key,
    label: input.label,
    status,
    detail: failedDetail ?? input.detail ?? input.job?.error ?? null,
    updatedAt: dateToIso(input.job?.updatedAt ?? input.fallbackUpdatedAt)
  };
}

function stepStatusFromJob(
  job: CorpusProgressJobSnapshot | undefined,
  completedFromState: boolean
): CorpusProgressStepStatus {
  if (completedFromState || job?.status === "COMPLETED") {
    return "done";
  }

  if (!job) {
    return "queued";
  }

  if (job.status === "RUNNING") {
    return "running";
  }

  if (job.status === "FAILED") {
    return "failed";
  }

  if (job.status === "CANCELLED") {
    return "skipped";
  }

  return "queued";
}

function jobCounts(
  jobs: CorpusProgressJobSnapshot[],
  corpusCounts: { chapters: number; chunks: number; embeddedChunks: number }
): CorpusProgressCounts {
  return {
    chapters: corpusCounts.chapters,
    chunks: corpusCounts.chunks,
    embeddedChunks: corpusCounts.embeddedChunks,
    totalJobs: jobs.length,
    completedJobs: jobs.filter((job) => job.status === "COMPLETED").length,
    runningJobs: jobs.filter((job) => job.status === "RUNNING").length,
    queuedJobs: jobs.filter((job) => QUEUED_JOB_STATUSES.has(job.status)).length,
    failedJobs: jobs.filter((job) => job.status === "FAILED").length
  };
}

function latestUpdatedJob(jobs: CorpusProgressJobSnapshot[]) {
  return [...jobs].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  )[0];
}

function isStepCompleteForProgress(step: CorpusProgressStep) {
  return (
    step.status === "done" ||
    step.status === "skipped" ||
    (step.key === "benchmark_ready" && step.status === "blocked")
  );
}

function latestIso(values: Array<Date | string | null | undefined>) {
  const times = values
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter(Number.isFinite);

  if (times.length === 0) {
    return new Date(0).toISOString();
  }

  return new Date(Math.max(...times)).toISOString();
}

function dateMillis(value: Date | string | null | undefined) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : 0;
}

function dateToIso(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function normalizeImportProgress(value: unknown): ImportProgress {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
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

function toJsonRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
