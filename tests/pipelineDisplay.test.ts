import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPipelineLockStatus,
  buildPipelineStatusDisplay,
  countPipelineJobsByStatus,
  shouldPollPipelineDiagnostics
} from "../lib/pipeline/display";
import { PIPELINE_JOB_STATUS } from "../lib/pipeline/jobRules";

test("pipeline display derives cumulative summarizeChunks progress", () => {
  const display = buildPipelineStatusDisplay({
    checkpoint: {
      completedSteps: [
        "parseAndNormalizeManuscript",
        "splitIntoChapters",
        "splitIntoChunks",
        "createEmbeddingsForChunks"
      ],
      currentStep: "summarizeChunks",
      stepMetadata: {
        summarizeChunks: {
          analyzed: 1,
          remaining: 30,
          complete: false,
          updatedAt: "2026-04-30T12:00:00.000Z"
        }
      }
    },
    jobs: [
      {
        type: "summarizeChunks",
        status: PIPELINE_JOB_STATUS.QUEUED,
        result: { analyzed: 1, remaining: 30, complete: false },
        updatedAt: "2026-04-30T11:59:00.000Z",
        createdAt: "2026-04-30T10:00:00.000Z"
      }
    ],
    totals: { chunks: 83 }
  });

  assert.equal(display.currentStep, "summarizeChunks");
  assert.equal(display.completedSteps, 4);
  assert.equal(display.totalSteps, 13);
  assert.equal(display.currentJobStatus, PIPELINE_JOB_STATUS.QUEUED);
  assert.equal(display.analyzedCount, 53);
  assert.equal(display.remainingCount, 30);
  assert.equal(display.complete, false);
  assert.equal(display.lastUpdatedAt, "2026-04-30T12:00:00.000Z");
  assert.equal(display.stepProgressLabel, "53 / 83 chunks summarized");
  assert.equal(display.remainingLabel, "30 remaining");
  assert.deepEqual(display.stepProgress, {
    step: "summarizeChunks",
    completed: 53,
    total: 83,
    remaining: 30,
    percent: 64,
    label: "53 / 83 chunks summarized",
    remainingLabel: "30 remaining"
  });
});

test("pipeline display derives runChapterAudits completion from total minus remaining", () => {
  const display = buildPipelineStatusDisplay({
    checkpoint: {
      completedSteps: [
        "parseAndNormalizeManuscript",
        "splitIntoChapters",
        "splitIntoChunks",
        "createEmbeddingsForChunks",
        "summarizeChunks",
        "summarizeChapters",
        "createManuscriptProfile"
      ],
      currentStep: "runChapterAudits",
      stepMetadata: {
        runChapterAudits: {
          audited: 4,
          remaining: 51,
          complete: false,
          updatedAt: "2026-05-01T12:00:00.000Z"
        }
      }
    },
    jobs: [
      {
        type: "runChapterAudits",
        status: PIPELINE_JOB_STATUS.RUNNING,
        result: { audited: 4, remaining: 51, complete: false },
        updatedAt: "2026-05-01T11:59:00.000Z",
        createdAt: "2026-05-01T10:00:00.000Z"
      }
    ],
    totals: { chapters: 75 }
  });

  assert.equal(display.currentStep, "runChapterAudits");
  assert.equal(display.analyzedCount, 24);
  assert.equal(display.remainingCount, 51);
  assert.equal(display.stepProgressLabel, "24 / 75 section audits completed");
  assert.equal(display.remainingLabel, "51 remaining");
  assert.deepEqual(display.stepProgress, {
    step: "runChapterAudits",
    completed: 24,
    total: 75,
    remaining: 51,
    percent: 32,
    label: "24 / 75 section audits completed",
    remainingLabel: "51 remaining"
  });
});

test("pipeline display avoids stale runChapterAudits analyzed count when total is unknown", () => {
  const display = buildPipelineStatusDisplay({
    checkpoint: {
      completedSteps: [
        "parseAndNormalizeManuscript",
        "splitIntoChapters",
        "splitIntoChunks",
        "createEmbeddingsForChunks",
        "summarizeChunks",
        "summarizeChapters",
        "createManuscriptProfile"
      ],
      currentStep: "runChapterAudits",
      stepMetadata: {
        runChapterAudits: {
          audited: 4,
          remaining: 51,
          complete: false
        }
      }
    },
    jobs: [
      {
        type: "runChapterAudits",
        status: PIPELINE_JOB_STATUS.QUEUED,
        result: { audited: 4, remaining: 51, complete: false },
        createdAt: "2026-05-01T10:00:00.000Z"
      }
    ]
  });

  assert.equal(display.analyzedCount, null);
  assert.equal(display.remainingCount, 51);
  assert.equal(display.stepProgressLabel, null);
  assert.equal(display.remainingLabel, "51 remaining");
  assert.deepEqual(display.stepProgress, {
    step: "runChapterAudits",
    completed: null,
    total: null,
    remaining: 51,
    percent: null,
    label: null,
    remainingLabel: "51 remaining"
  });
});

test("pipeline display splits job counts without folding blocked into queued", () => {
  const counts = countPipelineJobsByStatus([
    { status: PIPELINE_JOB_STATUS.QUEUED },
    { status: PIPELINE_JOB_STATUS.RETRYING },
    { status: PIPELINE_JOB_STATUS.RUNNING },
    { status: PIPELINE_JOB_STATUS.BLOCKED },
    { status: PIPELINE_JOB_STATUS.FAILED },
    { status: PIPELINE_JOB_STATUS.COMPLETED },
    { status: PIPELINE_JOB_STATUS.CANCELLED }
  ]);

  assert.deepEqual(counts, {
    queued: 2,
    running: 1,
    blocked: 1,
    failed: 1,
    completed: 1
  });
});

test("pipeline display reports next blocked step and latest job error", () => {
  const display = buildPipelineStatusDisplay({
    checkpoint: {
      completedSteps: ["parseAndNormalizeManuscript", "splitIntoChapters"]
    },
    run: {
      status: "RUNNING",
      error: null,
      updatedAt: "2026-04-30T09:00:00.000Z"
    },
    jobs: [
      {
        type: "splitIntoChunks",
        status: PIPELINE_JOB_STATUS.COMPLETED,
        createdAt: "2026-04-30T09:01:00.000Z"
      },
      {
        type: "createEmbeddingsForChunks",
        status: PIPELINE_JOB_STATUS.BLOCKED,
        createdAt: "2026-04-30T09:02:00.000Z"
      },
      {
        type: "summarizeChunks",
        status: PIPELINE_JOB_STATUS.FAILED,
        error: "Chunk analyzer failed.",
        updatedAt: "2026-04-30T09:03:00.000Z",
        createdAt: "2026-04-30T09:03:00.000Z"
      }
    ]
  });

  assert.equal(display.currentStep, "createEmbeddingsForChunks");
  assert.equal(display.currentJobStatus, PIPELINE_JOB_STATUS.BLOCKED);
  assert.equal(display.nextBlockedStep, "createEmbeddingsForChunks");
  assert.equal(display.lastError, "Chunk analyzer failed.");
});

test("pipeline lock status explains active and expired running locks", () => {
  const activeLock = buildPipelineLockStatus({
    type: "runChapterAudits",
    status: PIPELINE_JOB_STATUS.RUNNING,
    lockedBy: "manual:manuscript:abc",
    lockedAt: "2026-05-01T15:04:42.000Z",
    lockExpiresAt: "2026-05-01T15:14:42.000Z",
    stale: false
  });
  const staleLock = buildPipelineLockStatus({
    type: "runChapterAudits",
    status: PIPELINE_JOB_STATUS.RUNNING,
    lockedAt: "2026-05-01T15:04:42.000Z",
    lockExpiresAt: "2026-05-01T15:14:42.000Z",
    stale: true
  });

  assert.equal(activeLock?.type, "runChapterAudits");
  assert.equal(activeLock?.lockExpiresAt, "2026-05-01T15:14:42.000Z");
  assert.equal(activeLock?.stale, false);
  assert.match(
    activeLock?.message ?? "",
    /runChapterAudits is running and locked/
  );
  assert.match(activeLock?.message ?? "", /Wait for the current batch to finish/);
  assert.equal(
    staleLock?.message,
    "Lock expired. Click Run next batch to recover and continue."
  );
});

test("pipeline diagnostics polling continues for active work and stops for done or failed states", () => {
  assert.equal(
    shouldPollPipelineDiagnostics({
      state: "more_work_remains",
      pipelineStatus: {
        complete: false,
        currentJobStatus: PIPELINE_JOB_STATUS.RUNNING,
        lastError: null
      }
    }),
    true
  );
  assert.equal(
    shouldPollPipelineDiagnostics({
      manualRunner: { reason: "waiting_for_lock_expiry" },
      activeRunningJobs: [{ id: "job-1" }],
      pipelineStatus: {
        complete: false,
        currentJobStatus: PIPELINE_JOB_STATUS.RUNNING,
        lastError: null
      }
    }),
    true
  );
  assert.equal(
    shouldPollPipelineDiagnostics({
      state: "done",
      pipelineStatus: { complete: true, currentJobStatus: "COMPLETED" }
    }),
    false
  );
  assert.equal(
    shouldPollPipelineDiagnostics({
      state: "blocked_by_error",
      run: { status: "FAILED", error: "boom" },
      pipelineStatus: {
        complete: false,
        currentJobStatus: PIPELINE_JOB_STATUS.FAILED,
        lastError: "boom"
      }
    }),
    false
  );
});
