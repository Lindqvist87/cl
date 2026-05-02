import test from "node:test";
import assert from "node:assert/strict";
import {
  autoContinueManuscriptPipeline,
  type AutoContinueSnapshot
} from "../lib/pipeline/autoContinue";
import type {
  RunPipelineJobResult,
  RunReadyPipelineJobsResult
} from "../lib/pipeline/pipelineJobs";

test("auto-continue loops through multiple batches while work remains", async () => {
  const calls: Array<{ maxJobs?: number }> = [];
  const batches = [
    runReadyResult({
      jobsRun: 2,
      state: "more_work_remains",
      unfinishedJobs: 2,
      results: [jobResult("job-1"), jobResult("job-2")]
    }),
    runReadyResult({
      jobsRun: 1,
      state: "done",
      unfinishedJobs: 0,
      hasRemainingWork: false,
      moreWorkRemains: false,
      results: [jobResult("job-3")]
    })
  ];

  const result = await autoContinueManuscriptPipeline(
    {
      manuscriptId: "manuscript-auto-loop",
      maxBatches: 5,
      maxJobsPerBatch: 3,
      maxSeconds: 120
    },
    {
      runReadyJobs: async (options) => {
        calls.push({ maxJobs: options?.maxJobs });
        const next = batches.shift();
        assert.ok(next);
        return next;
      },
      getSnapshot: async () => snapshot({ finalState: "done" })
    }
  );

  assert.equal(result.batchesRun, 2);
  assert.equal(result.totalJobsRun, 3);
  assert.equal(result.stoppedReason, "done");
  assert.equal(result.finalState, "done");
  assert.equal(result.message, "Pipeline completed.");
  assert.equal(result.batchSummaries.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].maxJobs, 3);
});

test("auto-continue stops on active running lock", async () => {
  const blockingJob = blockingJobSummary({
    id: "audits-running",
    type: "runChapterAudits",
    lockExpiresAt: "2026-05-02T11:00:00.000Z"
  });

  const result = await autoContinueManuscriptPipeline(
    { manuscriptId: "manuscript-active-lock", maxBatches: 5 },
    {
      runReadyJobs: async () =>
        runReadyResult({
          jobsRun: 0,
          state: "more_work_remains",
          reason: "waiting_for_lock_expiry",
          blockingJob,
          message:
            "0 jobs ran because runChapterAudits is currently marked running."
        }),
      getSnapshot: async () =>
        snapshot({
          finalState: "more_work_remains",
          activeRunningJobs: [
            {
              ...blockingJob,
              error: null
            }
          ]
        })
    }
  );

  assert.equal(result.batchesRun, 1);
  assert.equal(result.totalJobsRun, 0);
  assert.equal(result.stoppedReason, "active_running_lock");
  assert.equal(result.blockingJob?.type, "runChapterAudits");
  assert.match(result.message, /Paused because runChapterAudits is locked until/);
});

test("auto-continue stops on failed job", async () => {
  const failedJob = {
    id: "corpus-failed",
    type: "compareAgainstCorpus",
    status: "FAILED",
    error: "Corpus comparison failed.",
    lockedBy: null,
    lockedAt: null,
    lockExpiresAt: null,
    stale: false
  };

  const result = await autoContinueManuscriptPipeline(
    { manuscriptId: "manuscript-failed", maxBatches: 5 },
    {
      runReadyJobs: async () =>
        runReadyResult({
          jobsRun: 1,
          state: "blocked_by_error",
          failedJobs: 1,
          results: [jobResult("corpus-failed", "failed")]
        }),
      getSnapshot: async () =>
        snapshot({
          finalState: "blocked_by_error",
          failedJobs: [failedJob]
        })
    }
  );

  assert.equal(result.stoppedReason, "blocked_by_error");
  assert.equal(result.failedJobs[0].type, "compareAgainstCorpus");
  assert.match(result.message, /compareAgainstCorpus failed/);
  assert.equal(result.hasRemainingWork, true);
});

test("auto-continue stops when maxBatches is reached", async () => {
  const result = await autoContinueManuscriptPipeline(
    {
      manuscriptId: "manuscript-max-batches",
      maxBatches: 2,
      maxJobsPerBatch: 1
    },
    {
      runReadyJobs: async () =>
        runReadyResult({
          jobsRun: 1,
          state: "more_work_remains",
          unfinishedJobs: 4,
          results: [jobResult("some-job")]
        }),
      getSnapshot: async () =>
        snapshot({
          finalState: "more_work_remains",
          nextEligibleJob: jobSummary("next-job", "summarizeChunks")
        })
    }
  );

  assert.equal(result.batchesRun, 2);
  assert.equal(result.totalJobsRun, 2);
  assert.equal(result.stoppedReason, "max_batches_reached");
  assert.equal(result.moreWorkRemains, true);
  assert.match(result.message, /Ran 2 batches, processed 2 items/);
});

test("auto-continue stops when maxSeconds is reached", async () => {
  const nowValues = [0, 0, 2000];

  const result = await autoContinueManuscriptPipeline(
    {
      manuscriptId: "manuscript-max-seconds",
      maxBatches: 5,
      maxSeconds: 1
    },
    {
      runReadyJobs: async () =>
        runReadyResult({
          jobsRun: 1,
          state: "more_work_remains",
          results: [jobResult("timed-job")]
        }),
      getSnapshot: async () =>
        snapshot({
          finalState: "more_work_remains",
          nextEligibleJob: jobSummary("next-job", "summarizeChunks")
        }),
      nowMs: () => nowValues.shift() ?? 2000
    }
  );

  assert.equal(result.batchesRun, 1);
  assert.equal(result.totalJobsRun, 1);
  assert.equal(result.stoppedReason, "max_seconds_reached");
  assert.match(result.message, /Time budget reached/);
});

test("auto-continue stops when the pipeline is done", async () => {
  const result = await autoContinueManuscriptPipeline(
    { manuscriptId: "manuscript-done", maxBatches: 5 },
    {
      runReadyJobs: async () =>
        runReadyResult({
          jobsRun: 0,
          state: "done",
          unfinishedJobs: 0,
          hasRemainingWork: false,
          moreWorkRemains: false
        }),
      getSnapshot: async () => snapshot({ finalState: "done" })
    }
  );

  assert.equal(result.batchesRun, 1);
  assert.equal(result.stoppedReason, "done");
  assert.equal(result.hasRemainingWork, false);
  assert.equal(result.message, "Pipeline completed.");
});

test("auto-continue pauses after stale job recovery", async () => {
  const recovered = blockingJobSummary({
    id: "stale-audits",
    type: "runChapterAudits",
    stale: true
  });

  const result = await autoContinueManuscriptPipeline(
    { manuscriptId: "manuscript-stale", maxBatches: 5 },
    {
      runReadyJobs: async () =>
        runReadyResult({
          jobsRun: 0,
          state: "more_work_remains",
          reason: "stale_running_job_recovered",
          recoveredStaleJobs: [recovered]
        }),
      getSnapshot: async () =>
        snapshot({
          finalState: "more_work_remains",
          nextEligibleJob: jobSummary("stale-audits", "runChapterAudits")
        })
    }
  );

  assert.equal(result.batchesRun, 1);
  assert.equal(result.totalJobsRun, 0);
  assert.equal(result.stoppedReason, "recovered_stale_job_needs_next_run");
  assert.equal(result.recoveredStaleJobs[0].type, "runChapterAudits");
  assert.match(result.message, /Recovered stale runChapterAudits/);
});

test("auto-continue response includes stoppedReason and batch summaries", async () => {
  const result = await autoContinueManuscriptPipeline(
    { manuscriptId: "manuscript-response-shape", maxBatches: 1 },
    {
      runReadyJobs: async () =>
        runReadyResult({
          jobsRun: 1,
          state: "more_work_remains",
          message: "Batch processed createEmbeddingsForChunks.",
          results: [jobResult("embedding-job", "queued")]
        }),
      getSnapshot: async () =>
        snapshot({
          finalState: "more_work_remains",
          nextEligibleJob: jobSummary("embedding-job", "createEmbeddingsForChunks")
        })
    }
  );

  assert.equal(result.stoppedReason, "max_batches_reached");
  assert.equal(result.batchSummaries.length, 1);
  assert.equal(
    result.batchSummaries[0].message,
    "Batch processed createEmbeddingsForChunks."
  );
  assert.equal(result.messages[0], "Batch processed createEmbeddingsForChunks.");
  assert.equal(result.nextEligibleJob?.type, "createEmbeddingsForChunks");
});

function runReadyResult(
  overrides: Partial<RunReadyPipelineJobsResult> = {}
): RunReadyPipelineJobsResult {
  const state = overrides.state ?? "more_work_remains";
  const hasRemainingWork =
    overrides.hasRemainingWork ?? state !== "done";

  return {
    jobsRun: overrides.jobsRun ?? 0,
    results: overrides.results ?? [],
    readyJobIds: overrides.readyJobIds ?? [],
    remainingReadyJobs: overrides.remainingReadyJobs ?? 0,
    unfinishedJobs: overrides.unfinishedJobs ?? (hasRemainingWork ? 1 : 0),
    failedJobs: overrides.failedJobs ?? (state === "blocked_by_error" ? 1 : 0),
    state,
    moreWorkRemains: overrides.moreWorkRemains ?? state === "more_work_remains",
    hasRemainingWork,
    reason: overrides.reason,
    message: overrides.message,
    blockingJob: overrides.blockingJob,
    recoveredStaleJobs: overrides.recoveredStaleJobs ?? []
  };
}

function snapshot(overrides: Partial<AutoContinueSnapshot> = {}): AutoContinueSnapshot {
  return {
    finalState: overrides.finalState ?? "more_work_remains",
    lastStep: overrides.lastStep ?? "summarizeChunks",
    remainingJobs: overrides.remainingJobs ?? [],
    failedJobs: overrides.failedJobs ?? [],
    activeRunningJobs: overrides.activeRunningJobs ?? [],
    nextEligibleJob: overrides.nextEligibleJob ?? null
  };
}

function jobResult(
  jobId: string,
  status: RunPipelineJobResult["status"] = "completed"
): RunPipelineJobResult {
  return {
    jobId,
    manuscriptId: "manuscript",
    type: "summarizeChunks",
    status,
    readyJobIds: []
  };
}

function jobSummary(id: string, type: string) {
  return {
    id,
    type,
    status: "QUEUED",
    error: null,
    lockedBy: null,
    lockedAt: null,
    lockExpiresAt: null,
    stale: false
  };
}

function blockingJobSummary(overrides: {
  id: string;
  type: string;
  lockExpiresAt?: string;
  stale?: boolean;
}) {
  return {
    id: overrides.id,
    type: overrides.type,
    status: "RUNNING",
    lockedBy: "test-worker",
    lockedAt: "2026-05-02T10:00:00.000Z",
    lockExpiresAt: overrides.lockExpiresAt ?? "2026-05-02T10:05:00.000Z",
    stale: overrides.stale ?? false
  };
}
