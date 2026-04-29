import test from "node:test";
import assert from "node:assert/strict";
import {
  CORPUS_PIPELINE_JOB_TYPES,
  corpusPipelineJobKey,
  plannedCorpusPipelineJobs,
  shouldShowCorpusAnalysisAction,
  summarizeCorpusAnalysis
} from "../lib/corpus/corpusAnalysisJobs";
import {
  corpusAnalysisExecutionMode,
  corpusAnalysisHttpStatus
} from "../lib/corpus/startCorpusAnalysis";
import {
  buildCorpusProgressStatus,
  getCorpusProgressAction,
  shouldPollCorpusStatus,
  staleWarningText,
  type CorpusProgressBuildInput
} from "../lib/corpus/corpusProgressShared";
import { PIPELINE_JOB_STATUS } from "../lib/pipeline/jobRules";

test("importing a corpus book plans the full analysis job chain", () => {
  const jobs = plannedCorpusPipelineJobs("book-1");

  assert.deepEqual(
    jobs.map((job) => job.type),
    [
      CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN,
      CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS,
      CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHUNK,
      CORPUS_PIPELINE_JOB_TYPES.CORPUS_EMBED,
      CORPUS_PIPELINE_JOB_TYPES.CORPUS_PROFILE,
      CORPUS_PIPELINE_JOB_TYPES.CORPUS_BENCHMARK_CHECK
    ]
  );
  assert.deepEqual(jobs[0].dependencyKeys, []);
  assert.deepEqual(jobs[1].dependencyKeys, [jobs[0].idempotencyKey]);
  assert.deepEqual(jobs[5].dependencyKeys, [jobs[4].idempotencyKey]);
});

test("run-analysis uses deterministic keys for missing jobs", () => {
  const jobs = plannedCorpusPipelineJobs("book-2");

  assert.equal(
    jobs[0].idempotencyKey,
    corpusPipelineJobKey("book-2", CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN)
  );
  assert.equal(
    jobs[3].idempotencyKey,
    corpusPipelineJobKey("book-2", CORPUS_PIPELINE_JOB_TYPES.CORPUS_EMBED)
  );
});

test("run-analysis does not duplicate existing job identities", () => {
  const first = plannedCorpusPipelineJobs("book-3");
  const second = plannedCorpusPipelineJobs("book-3");

  assert.deepEqual(
    second.map((job) => job.idempotencyKey),
    first.map((job) => job.idempotencyKey)
  );
  assert.equal(new Set(first.map((job) => job.idempotencyKey)).size, first.length);
});

test("Inngest event mode is selected when enabled", () => {
  assert.equal(
    corpusAnalysisExecutionMode({
      inngestEnabled: true,
      runFallbackWhenDisabled: true
    }),
    "INNGEST"
  );
  assert.equal(
    corpusAnalysisHttpStatus({ executionMode: "INNGEST", accepted: true }),
    202
  );
});

test("fallback mode remains available when Inngest is disabled", () => {
  assert.equal(
    corpusAnalysisExecutionMode({
      inngestEnabled: false,
      runFallbackWhenDisabled: true
    }),
    "MANUAL"
  );
  assert.equal(
    corpusAnalysisExecutionMode({
      inngestEnabled: false,
      runFallbackWhenDisabled: false
    }),
    "QUEUED"
  );
});

test("status moves from not started to queued/running once jobs exist", () => {
  const plans = plannedCorpusPipelineJobs("book-4");
  const summary = summarizeCorpusAnalysis({
    book: {
      id: "book-4",
      fullTextAvailable: true,
      ingestionStatus: "IMPORTED",
      analysisStatus: "RUNNING",
      benchmarkReady: false,
      benchmarkBlockedReason: null,
      importProgress: {
        uploaded: true,
        textExtracted: true,
        cleaned: true
      }
    },
    jobs: plans.map((job, index) => ({
      id: `job-${index}`,
      type: job.type,
      status:
        index === 0
          ? PIPELINE_JOB_STATUS.COMPLETED
          : index === 1
            ? PIPELINE_JOB_STATUS.QUEUED
            : PIPELINE_JOB_STATUS.BLOCKED,
      error: null
    })),
    profileExists: false,
    chapterCount: 0,
    chunkCount: 0,
    embeddingStatuses: []
  });

  assert.equal(summary.analysisStatus, "RUNNING");
  assert.equal(summary.steps.imported.statusLabel, "Imported");
  assert.equal(summary.steps.cleaning.statusLabel, "Done");
  assert.equal(summary.steps.chapters.statusLabel, "Queued");
  assert.equal(summary.readyJobCount, 1);
  assert.equal(summary.unfinishedJobCount, 5);
});

test("legacy imported corpus books with no jobs still show the analysis action", () => {
  const summary = summarizeCorpusAnalysis({
    book: {
      id: "legacy-book",
      fullTextAvailable: true,
      ingestionStatus: "IMPORTED",
      analysisStatus: "NOT_STARTED",
      benchmarkReady: false,
      benchmarkBlockedReason: null,
      importProgress: {
        uploaded: true,
        textExtracted: true,
        cleaned: true
      }
    },
    jobs: [],
    profileExists: false,
    chapterCount: 0,
    chunkCount: 0,
    embeddingStatuses: []
  });

  assert.equal(summary.steps.imported.statusLabel, "Imported");
  assert.equal(summary.steps.bookDna.statusLabel, "Not started");
  assert.equal(
    shouldShowCorpusAnalysisAction({
      analysisStatus: "NOT_STARTED",
      summary
    }),
    true
  );
});

test("status endpoint response builder returns progress JSON shape", () => {
  const status = buildCorpusProgressStatus(
    progressInput({
      importProgress: {
        cleaned: true,
        chaptersDetected: true
      },
      jobs: [
        corpusJob("CORPUS_CLEAN", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:01:00Z"),
        corpusJob("CORPUS_CHAPTERS", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:02:00Z"),
        corpusJob("CORPUS_CHUNK", PIPELINE_JOB_STATUS.RUNNING, "2026-04-29T10:03:00Z")
      ],
      counts: {
        chapters: 12,
        chunks: 0,
        embeddedChunks: 0
      }
    })
  );

  assert.equal(status.bookId, "book-progress");
  assert.equal(status.counts.chapters, 12);
  assert.equal(status.counts.totalJobs, 3);
  assert.equal(status.counts.runningJobs, 1);
  assert.deepEqual(
    status.steps.map((step) => step.key),
    [
      "imported",
      "cleaning",
      "chapters",
      "chunks",
      "embeddings",
      "book_dna",
      "benchmark_ready"
    ]
  );
  assert.equal(status.progress.currentStepLabel, "Chunks");
});

test("corpus progress percent is calculated from completed stages", () => {
  const status = buildCorpusProgressStatus(
    progressInput({
      benchmarkBlockedReason: "Benchmark use is not allowed.",
      importProgress: {
        cleaned: true,
        chaptersDetected: true,
        chunksCreated: true,
        embeddingsCreated: true,
        embeddingStatus: "skipped: OPENAI_API_KEY not configured",
        bookDnaExtracted: true
      },
      profileExists: true,
      counts: {
        chapters: 12,
        chunks: 24,
        embeddedChunks: 0
      },
      embeddingStatusCounts: [{ status: "SKIPPED", count: 24 }],
      jobs: [
        corpusJob("CORPUS_CLEAN", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:01:00Z"),
        corpusJob("CORPUS_CHAPTERS", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:02:00Z"),
        corpusJob("CORPUS_CHUNK", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:03:00Z"),
        corpusJob("CORPUS_EMBED", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:04:00Z"),
        corpusJob("CORPUS_PROFILE", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:05:00Z"),
        corpusJob("CORPUS_BENCHMARK_CHECK", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:06:00Z")
      ]
    })
  );

  assert.equal(status.steps.find((step) => step.key === "embeddings")?.status, "skipped");
  assert.equal(status.steps.find((step) => step.key === "benchmark_ready")?.status, "blocked");
  assert.equal(status.progress.percent, 100);
  assert.equal(status.progress.isBlocked, true);
  assert.equal(status.progress.isComplete, true);
});

test("polling is active only while corpus work is queued or running", () => {
  const running = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "RUNNING",
      jobs: [
        corpusJob("CORPUS_CLEAN", PIPELINE_JOB_STATUS.RUNNING, "2026-04-29T10:01:00Z")
      ]
    })
  );
  const noActiveJobs = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "RUNNING",
      jobs: [
        corpusJob("CORPUS_CLEAN", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:01:00Z")
      ]
    })
  );

  assert.equal(shouldPollCorpusStatus(running), true);
  assert.equal(shouldPollCorpusStatus(noActiveJobs), false);
});

test("polling stops when corpus analysis is complete", () => {
  const complete = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "COMPLETED",
      benchmarkReady: true,
      importProgress: {
        cleaned: true,
        chaptersDetected: true,
        chunksCreated: true,
        embeddingsCreated: true,
        bookDnaExtracted: true
      },
      profileExists: true,
      counts: {
        chapters: 12,
        chunks: 24,
        embeddedChunks: 24
      },
      embeddingStatusCounts: [{ status: "STORED", count: 24 }]
    })
  );

  assert.equal(complete.progress.isComplete, true);
  assert.equal(shouldPollCorpusStatus(complete), false);
});

test("failed job appears in corpus status response", () => {
  const status = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "FAILED",
      jobs: [
        corpusJob(
          "CORPUS_EMBED",
          PIPELINE_JOB_STATUS.FAILED,
          "2026-04-29T10:04:00Z",
          "Embedding provider rejected the request."
        )
      ]
    })
  );

  assert.equal(status.counts.failedJobs, 1);
  assert.equal(status.latestJob?.status, PIPELINE_JOB_STATUS.FAILED);
  assert.equal(status.latestJob?.error, "Embedding provider rejected the request.");
  assert.equal(status.steps.find((step) => step.key === "embeddings")?.status, "failed");
  assert.equal(status.progress.isFailed, true);
});

test("stale job warning appears when latest job update is old", () => {
  const now = new Date("2026-04-29T10:05:00Z");
  const status = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "RUNNING",
      jobs: [
        corpusJob("CORPUS_CHUNK", PIPELINE_JOB_STATUS.RUNNING, "2026-04-29T10:00:00Z")
      ]
    })
  );

  assert.equal(
    staleWarningText(status, now),
    "Analysis may be stuck. Last job update was 5 minutes ago."
  );
});

test("corpus retry and resume button state is derived from progress", () => {
  const now = new Date("2026-04-29T10:05:00Z");
  const failed = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "FAILED",
      jobs: [
        corpusJob("CORPUS_EMBED", PIPELINE_JOB_STATUS.FAILED, "2026-04-29T10:02:00Z")
      ]
    })
  );
  const stale = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "RUNNING",
      jobs: [
        corpusJob("CORPUS_CHUNK", PIPELINE_JOB_STATUS.RUNNING, "2026-04-29T10:00:00Z")
      ]
    })
  );
  const completeReady = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "COMPLETED",
      benchmarkReady: true,
      profileExists: true,
      importProgress: {
        cleaned: true,
        chaptersDetected: true,
        chunksCreated: true,
        embeddingsCreated: true,
        bookDnaExtracted: true
      },
      counts: {
        chapters: 12,
        chunks: 24,
        embeddedChunks: 24
      },
      embeddingStatusCounts: [{ status: "STORED", count: 24 }]
    })
  );
  const completeNotReady = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "COMPLETED",
      profileExists: true,
      importProgress: {
        cleaned: true,
        chaptersDetected: true,
        chunksCreated: true,
        embeddingsCreated: true,
        bookDnaExtracted: true
      }
    })
  );
  const notStarted = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "NOT_STARTED",
      ingestionStatus: "IMPORTED"
    })
  );

  assert.equal(getCorpusProgressAction(failed, now).kind, "retry_failed");
  assert.equal(getCorpusProgressAction(stale, now).kind, "resume");
  assert.equal(getCorpusProgressAction(completeReady, now).kind, "view_book_dna");
  assert.equal(
    getCorpusProgressAction(completeNotReady, now).kind,
    "check_benchmark"
  );
  assert.equal(getCorpusProgressAction(notStarted, now).kind, "start");
});

function progressInput(
  overrides: Partial<
    Omit<CorpusProgressBuildInput, "book"> & {
      analysisStatus: string;
      benchmarkBlockedReason: string | null;
      benchmarkReady: boolean;
      fullTextAvailable: boolean;
      ingestionStatus: string;
      importProgress: Record<string, unknown>;
      profileExists: boolean;
    }
  > = {}
): CorpusProgressBuildInput {
  return {
    book: {
      id: "book-progress",
      fullTextAvailable: overrides.fullTextAvailable ?? true,
      ingestionStatus: overrides.ingestionStatus ?? "IMPORTED",
      analysisStatus: overrides.analysisStatus ?? "RUNNING",
      benchmarkReady: overrides.benchmarkReady ?? false,
      benchmarkBlockedReason: overrides.benchmarkBlockedReason,
      updatedAt: "2026-04-29T10:00:00Z",
      importProgress: {
        uploaded: true,
        textExtracted: true,
        ...(overrides.importProgress ?? {})
      },
      textCleanedAt: "2026-04-29T10:01:00Z",
      latestImportStep: "uploaded",
      latestImportUpdatedAt: "2026-04-29T10:01:00Z",
      profileCreatedAt: overrides.profileExists ? "2026-04-29T10:05:00Z" : null,
      profileExists: overrides.profileExists ?? false
    },
    counts: overrides.counts ?? {
      chapters: 0,
      chunks: 0,
      embeddedChunks: 0
    },
    embeddingStatusCounts: overrides.embeddingStatusCounts ?? [],
    jobs: overrides.jobs ?? []
  };
}

function corpusJob(
  type: string,
  status: string,
  updatedAt: string,
  error: string | null = null
) {
  return {
    id: `${type}-${status}`,
    type,
    status,
    updatedAt,
    error
  };
}
