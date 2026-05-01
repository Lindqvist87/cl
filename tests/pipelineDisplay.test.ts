import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPipelineStatusDisplay,
  countPipelineJobsByStatus
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
