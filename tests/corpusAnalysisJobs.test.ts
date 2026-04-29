import test from "node:test";
import assert from "node:assert/strict";
import {
  CORPUS_PIPELINE_JOB_TYPES,
  corpusPipelineJobKey,
  plannedCorpusPipelineJobs,
  summarizeCorpusAnalysis
} from "../lib/corpus/corpusAnalysisJobs";
import {
  corpusAnalysisExecutionMode,
  corpusAnalysisHttpStatus
} from "../lib/corpus/startCorpusAnalysis";
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
