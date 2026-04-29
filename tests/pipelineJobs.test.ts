import test from "node:test";
import assert from "node:assert/strict";
import { pipelineStartHttpStatus } from "../lib/pipeline/startPipeline";
import { plannedPipelineJobs } from "../lib/pipeline/jobPlanner";
import {
  areDependenciesComplete,
  canAttemptJob,
  dependencyIdsFromJson,
  executionModeLabel,
  isCompletedJob,
  isJobCancelled,
  isLockStale,
  nextStatusAfterJobError,
  PIPELINE_JOB_STATUS
} from "../lib/pipeline/jobRules";

test("pipeline.started plans ordered jobs with dependencies", () => {
  const jobs = plannedPipelineJobs("m1", {
    completedSteps: ["parseAndNormalizeManuscript"]
  });

  assert.equal(jobs.length > 3, true);
  assert.equal(jobs[0].type, "parseAndNormalizeManuscript");
  assert.equal(jobs[0].completedFromCheckpoint, true);
  assert.deepEqual(jobs[0].dependencyKeys, []);
  assert.deepEqual(jobs[1].dependencyKeys, [jobs[0].idempotencyKey]);
});

test("job.created can run one eligible job", () => {
  assert.equal(
    canAttemptJob({
      status: PIPELINE_JOB_STATUS.QUEUED,
      readyAt: new Date("2026-04-29T05:00:00Z"),
      lockedAt: null
    }, new Date("2026-04-29T05:01:00Z")),
    true
  );
});

test("active locks prevent duplicate execution until stale", () => {
  const now = new Date("2026-04-29T05:01:00Z");

  assert.equal(
    canAttemptJob(
      {
        status: PIPELINE_JOB_STATUS.QUEUED,
        lockedAt: new Date("2026-04-29T05:00:00Z"),
        lockExpiresAt: new Date("2026-04-29T05:05:00Z")
      },
      now
    ),
    false
  );
  assert.equal(
    canAttemptJob(
      {
        status: PIPELINE_JOB_STATUS.QUEUED,
        lockedAt: new Date("2026-04-29T04:00:00Z"),
        lockExpiresAt: new Date("2026-04-29T05:00:00Z")
      },
      now
    ),
    true
  );
});

test("dependencies block jobs until all prerequisites complete", () => {
  const ids = dependencyIdsFromJson(["a", "b"]);

  assert.equal(
    areDependenciesComplete(ids, [
      { id: "a", status: PIPELINE_JOB_STATUS.COMPLETED },
      { id: "b", status: PIPELINE_JOB_STATUS.QUEUED }
    ]),
    false
  );
  assert.equal(
    areDependenciesComplete(ids, [
      { id: "a", status: PIPELINE_JOB_STATUS.COMPLETED },
      { id: "b", status: PIPELINE_JOB_STATUS.COMPLETED }
    ]),
    true
  );
});

test("completed and cancelled jobs are skipped", () => {
  assert.equal(isCompletedJob({ status: PIPELINE_JOB_STATUS.COMPLETED }), true);
  assert.equal(isJobCancelled({ status: PIPELINE_JOB_STATUS.CANCELLED }), true);
  assert.equal(canAttemptJob({ status: PIPELINE_JOB_STATUS.COMPLETED }), false);
  assert.equal(canAttemptJob({ status: PIPELINE_JOB_STATUS.CANCELLED }), false);
});

test("stale locks are detectable", () => {
  assert.equal(
    isLockStale(
      {
        status: PIPELINE_JOB_STATUS.RUNNING,
        lockExpiresAt: new Date("2026-04-29T05:00:00Z")
      },
      new Date("2026-04-29T05:01:00Z")
    ),
    true
  );
});

test("failed jobs retry until maxAttempts then fail", () => {
  assert.equal(
    nextStatusAfterJobError({ attempts: 2, maxAttempts: 3 }),
    PIPELINE_JOB_STATUS.RETRYING
  );
  assert.equal(
    nextStatusAfterJobError({ attempts: 3, maxAttempts: 3 }),
    PIPELINE_JOB_STATUS.FAILED
  );
});

test("fallback runner mode remains explicit when Inngest is disabled", () => {
  assert.equal(
    executionModeLabel({ inngestEnabled: false }),
    "Manual/request runner"
  );
  assert.equal(
    executionModeLabel({ inngestEnabled: true }),
    "Inngest worker enabled"
  );
});

test("pipeline start responses only accept successful Inngest dispatches", () => {
  assert.equal(
    pipelineStartHttpStatus({ executionMode: "INNGEST", accepted: true }),
    202
  );
  assert.equal(
    pipelineStartHttpStatus({ executionMode: "INNGEST", accepted: false }),
    503
  );
  assert.equal(
    pipelineStartHttpStatus({ executionMode: "MANUAL", accepted: false }),
    200
  );
});
