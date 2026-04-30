import test from "node:test";
import assert from "node:assert/strict";
import { requireAdminJobToken } from "../lib/server/adminJobAuth";

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

function restoreAdminJobToken(value: string | undefined) {
  if (value === undefined) {
    delete process.env.ADMIN_JOB_TOKEN;
  } else {
    process.env.ADMIN_JOB_TOKEN = value;
  }
}
