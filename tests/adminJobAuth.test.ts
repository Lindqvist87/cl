import test from "node:test";
import assert from "node:assert/strict";
import { POST as adminRunJobsPost } from "../app/api/admin/manuscripts/[id]/run-jobs/route";
import { POST as runNextPost } from "../app/api/jobs/run-next/route";
import { POST as runUntilIdlePost } from "../app/api/jobs/run-until-idle/route";
import { requireAdminJobToken } from "../lib/server/adminJobAuth";
import {
  manuscriptAdminJobRunner,
  manuscriptAdminRunJobOptions
} from "../lib/server/manuscriptAdminJobs";

test("admin job auth accepts bearer token", () => {
  const oldToken = process.env.ADMIN_JOB_TOKEN;
  process.env.ADMIN_JOB_TOKEN = "test-admin-token";

  const response = requireAdminJobToken(
    new Request("http://localhost/api/jobs/run-next", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-admin-token"
      }
    })
  );

  assert.equal(response, null);
  restoreAdminJobToken(oldToken);
});

test("admin job auth accepts x-admin-job-token header", () => {
  const oldToken = process.env.ADMIN_JOB_TOKEN;
  process.env.ADMIN_JOB_TOKEN = "test-admin-token";

  const response = requireAdminJobToken(
    new Request("http://localhost/api/jobs/run-until-idle", {
      method: "POST",
      headers: {
        "x-admin-job-token": "test-admin-token"
      }
    })
  );

  assert.equal(response, null);
  restoreAdminJobToken(oldToken);
});

test("admin job auth rejects missing or invalid tokens without echoing secrets", async () => {
  const oldToken = process.env.ADMIN_JOB_TOKEN;
  process.env.ADMIN_JOB_TOKEN = "test-admin-token";

  const missing = requireAdminJobToken(
    new Request("http://localhost/api/jobs/run-next", { method: "POST" })
  );
  const invalid = requireAdminJobToken(
    new Request("http://localhost/api/jobs/run-next", {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong-token"
      }
    })
  );

  assert.equal(missing?.status, 401);
  assert.equal(invalid?.status, 401);
  assert.equal(
    JSON.stringify(await invalid?.json()).includes("test-admin-token"),
    false
  );
  restoreAdminJobToken(oldToken);
});

test("admin job auth fails closed when ADMIN_JOB_TOKEN is unset", async () => {
  const oldToken = process.env.ADMIN_JOB_TOKEN;
  delete process.env.ADMIN_JOB_TOKEN;

  const response = requireAdminJobToken(
    new Request("http://localhost/api/jobs/run-next", { method: "POST" })
  );

  assert.equal(response?.status, 503);
  assert.deepEqual(await response?.json(), {
    error: "ADMIN_JOB_TOKEN is not configured."
  });
  restoreAdminJobToken(oldToken);
});

test("protected job routes reject browser requests without admin token", async () => {
  const oldToken = process.env.ADMIN_JOB_TOKEN;
  process.env.ADMIN_JOB_TOKEN = "test-admin-token";

  const runNext = await runNextPost(
    new Request("http://localhost/api/jobs/run-next", { method: "POST" })
  );
  const runUntilIdle = await runUntilIdlePost(
    new Request("http://localhost/api/jobs/run-until-idle", { method: "POST" })
  );

  assert.equal(runNext.status, 401);
  assert.equal(runUntilIdle.status, 401);
  restoreAdminJobToken(oldToken);
});

test("manuscript admin job route runs server-side without browser token", async (t) => {
  const oldToken = process.env.ADMIN_JOB_TOKEN;
  delete process.env.ADMIN_JOB_TOKEN;

  const run = t.mock.method(
    manuscriptAdminJobRunner,
    "run",
    async (manuscriptId: string) => ({
      jobsRun: 1,
      results: [
        {
          jobId: "job-1",
          manuscriptId,
          type: "summarizeChunks",
          status: "queued",
          readyJobIds: ["job-1"]
        }
      ],
      remainingReadyJobs: 1,
      hasRemainingWork: true,
      progress: {
        currentStep: "summarizeChunks",
        analyzed: 1,
        remaining: 2,
        complete: false,
        completed: 4,
        total: 13,
        percent: 31
      }
    })
  );

  const response = await adminRunJobsPost(
    new Request("http://localhost/api/admin/manuscripts/m1/run-jobs", {
      method: "POST"
    }),
    { params: Promise.resolve({ id: "m1" }) }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(run.mock.callCount(), 1);
  assert.equal(run.mock.calls[0].arguments[0], "m1");
  assert.equal(body.progress.currentStep, "summarizeChunks");
  assert.equal(body.progress.analyzed, 1);
  assert.equal(body.progress.remaining, 2);
  assert.equal(body.progress.complete, false);
  restoreAdminJobToken(oldToken);
});

test("manuscript admin route options pass maxItemsPerStep", () => {
  assert.deepEqual(manuscriptAdminRunJobOptions("m1", {}), {
    manuscriptId: "m1",
    maxBatches: 5,
    maxJobsPerBatch: 5,
    maxSeconds: 240,
    maxItemsPerStep: 4,
    workerType: "MANUAL",
    workerId: "manual:manuscript:m1"
  });
  assert.deepEqual(
    manuscriptAdminRunJobOptions("m1", {
      maxBatches: 2,
      maxJobsPerBatch: 9,
      maxSeconds: 90,
      maxItemsPerStep: 3
    }),
    {
      manuscriptId: "m1",
      maxBatches: 2,
      maxJobsPerBatch: 9,
      maxSeconds: 90,
      maxItemsPerStep: 3,
      workerType: "MANUAL",
      workerId: "manual:manuscript:m1"
    }
  );
});

function restoreAdminJobToken(value: string | undefined) {
  if (value === undefined) {
    delete process.env.ADMIN_JOB_TOKEN;
  } else {
    process.env.ADMIN_JOB_TOKEN = value;
  }
}
