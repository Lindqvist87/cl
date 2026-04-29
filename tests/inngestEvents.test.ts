import test from "node:test";
import assert from "node:assert/strict";
import {
  getInngestRuntimeConfig,
  jobEventPayload,
  manuscriptPipelineStartedPayload
} from "../src/inngest/events";
import { getEnvVarChecks } from "../lib/system/envCheck";

test("Inngest event payload creation is stable", () => {
  const payload = manuscriptPipelineStartedPayload({
    manuscriptId: "m1",
    requestedBy: null,
    mode: "FULL_PIPELINE",
    createdAt: new Date("2026-04-29T05:00:00.000Z")
  });

  assert.deepEqual(payload, {
    manuscriptId: "m1",
    requestedBy: null,
    mode: "FULL_PIPELINE",
    createdAt: "2026-04-29T05:00:00.000Z"
  });
});

test("job event payload includes corpusBookId diagnostics", () => {
  assert.deepEqual(
    jobEventPayload({
      jobId: "job-1",
      manuscriptId: null,
      corpusBookId: "book-1",
      type: "CORPUS_CHAPTERS"
    }),
    {
      jobId: "job-1",
      manuscriptId: null,
      corpusBookId: "book-1",
      type: "CORPUS_CHAPTERS"
    }
  );
});

test("missing Inngest env vars do not crash and keep fallback visible", () => {
  const oldEnabled = process.env.ENABLE_INNGEST_WORKER;
  const oldEventKey = process.env.INNGEST_EVENT_KEY;
  const oldSigningKey = process.env.INNGEST_SIGNING_KEY;
  const oldDev = process.env.INNGEST_DEV;

  delete process.env.INNGEST_EVENT_KEY;
  delete process.env.INNGEST_SIGNING_KEY;
  delete process.env.INNGEST_DEV;
  process.env.ENABLE_INNGEST_WORKER = "false";

  const disabled = getInngestRuntimeConfig();
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.canSendEvents, false);
  assert.deepEqual(disabled.warnings, []);

  process.env.ENABLE_INNGEST_WORKER = "true";
  const enabledButMissing = getInngestRuntimeConfig();
  assert.equal(enabledButMissing.enabled, true);
  assert.equal(enabledButMissing.canSendEvents, false);
  assert.equal(enabledButMissing.warnings.length, 2);

  restore("ENABLE_INNGEST_WORKER", oldEnabled);
  restore("INNGEST_EVENT_KEY", oldEventKey);
  restore("INNGEST_SIGNING_KEY", oldSigningKey);
  restore("INNGEST_DEV", oldDev);
});

test("system env check reports present and missing without values", () => {
  const oldApiKey = process.env.OPENAI_API_KEY;
  const oldDatabaseUrl = process.env.DATABASE_URL;

  process.env.OPENAI_API_KEY = "secret-value-that-must-not-appear";
  delete process.env.DATABASE_URL;

  const checks = getEnvVarChecks(["OPENAI_API_KEY", "DATABASE_URL"]);

  assert.deepEqual(checks, [
    { name: "OPENAI_API_KEY", status: "Present" },
    { name: "DATABASE_URL", status: "Missing" }
  ]);
  assert.equal(
    JSON.stringify(checks).includes("secret-value-that-must-not-appear"),
    false
  );

  restore("OPENAI_API_KEY", oldApiKey);
  restore("DATABASE_URL", oldDatabaseUrl);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
