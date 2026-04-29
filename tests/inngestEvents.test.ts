import test from "node:test";
import assert from "node:assert/strict";
import {
  getInngestRuntimeConfig,
  manuscriptPipelineStartedPayload
} from "../src/inngest/events";

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

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
