import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authorAnalysisAction,
  isRecoverableQueuedAnalysis
} from "../lib/pipeline/authorActions";
import type { PipelineStatusDisplay } from "../lib/pipeline/display";
import { PIPELINE_JOB_STATUS } from "../lib/pipeline/jobRules";

test("recoverable queued analysis exposes the author continue action", () => {
  const action = authorAnalysisAction({
    manuscriptId: "manuscript-recoverable",
    analysisReady: false,
    analysisStatus: "RUNNING",
    pipelineStatus: statusDisplay({
      currentJobStatus: PIPELINE_JOB_STATUS.QUEUED,
      jobCounts: { queued: 1, blocked: 8, running: 0, failed: 0, completed: 4 }
    })
  });

  assert.deepEqual(action, {
    mode: "continue",
    endpoint: "/api/manuscripts/manuscript-recoverable/resume-pipeline",
    label: "Fortsätt analys",
    runningLabel: "Fortsätter..."
  });
});

test("running analysis with queued work does not leave a dead start action", () => {
  const action = authorAnalysisAction({
    manuscriptId: "manuscript-running",
    analysisReady: false,
    analysisStatus: "RUNNING",
    pipelineStatus: statusDisplay({
      currentJobStatus: PIPELINE_JOB_STATUS.BLOCKED,
      jobCounts: { queued: 1, blocked: 7, running: 0, failed: 0, completed: 5 }
    })
  });

  assert.equal(action?.mode, "continue");
  assert.notEqual(action?.label, "Starta analys");
});

test("not-started analysis still exposes the start action", () => {
  const action = authorAnalysisAction({
    manuscriptId: "manuscript-new",
    analysisReady: false,
    analysisStatus: "NOT_STARTED",
    pipelineStatus: statusDisplay()
  });

  assert.equal(action?.mode, "start");
  assert.equal(action?.endpoint, "/api/manuscripts/manuscript-new/run-pipeline");
});

test("author continue button calls the resume route and auto-continue refreshes progress", () => {
  const buttonSource = readFileSync("components/AuditButton.tsx", "utf8");
  const autoSource = readFileSync("components/PipelineAutoContinue.tsx", "utf8");
  const routeSource = readFileSync(
    "app/api/manuscripts/[id]/resume-pipeline/route.ts",
    "utf8"
  );

  assert.match(buttonSource, /mode === "continue"/);
  assert.match(buttonSource, /resume-pipeline/);
  assert.match(buttonSource, /Fortsätt analys/);
  assert.match(autoSource, /resume-pipeline/);
  assert.match(autoSource, /nextEligibleJob/);
  assert.match(autoSource, /staleRunningJobs/);
  assert.match(routeSource, /manuscriptAdminJobRunner\.run/);
});

test("recoverability includes queued, retrying, and stale locked work", () => {
  assert.equal(
    isRecoverableQueuedAnalysis(
      statusDisplay({ currentJobStatus: PIPELINE_JOB_STATUS.RETRYING })
    ),
    true
  );
  assert.equal(
    isRecoverableQueuedAnalysis(
      statusDisplay({
        currentJobStatus: PIPELINE_JOB_STATUS.RUNNING,
        lockStatus: {
          type: "summarizeChunks",
          status: PIPELINE_JOB_STATUS.RUNNING,
          lockedBy: "worker",
          lockedAt: "2026-05-03T10:00:00.000Z",
          lockExpiresAt: "2026-05-03T10:10:00.000Z",
          stale: true,
          message: "Lock expired."
        }
      })
    ),
    true
  );
});

function statusDisplay(
  overrides: Partial<PipelineStatusDisplay> = {}
): PipelineStatusDisplay {
  const { jobCounts, ...rest } = overrides;

  return {
    currentStep: null,
    nextStep: null,
    completedSteps: 0,
    totalSteps: 12,
    percent: 0,
    currentJobStatus: null,
    analyzedCount: null,
    remainingCount: null,
    complete: false,
    lastUpdatedAt: null,
    lastError: null,
    nextBlockedStep: null,
    stepProgressLabel: null,
    remainingLabel: null,
    stepProgress: null,
    lockStatus: null,
    coreAnalysisComplete: false,
    optionalRewriteDraftsPending: false,
    ...rest,
    jobCounts: {
      queued: 0,
      running: 0,
      blocked: 0,
      failed: 0,
      completed: 0,
      ...jobCounts
    }
  };
}
