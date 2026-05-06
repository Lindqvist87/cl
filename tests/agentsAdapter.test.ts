import test from "node:test";
import assert from "node:assert/strict";
import { agentsSdkReadiness } from "../lib/ai/agents/adapter";

test("Agents SDK boundary remains isolated until dependency upgrade is verified", () => {
  const readiness = agentsSdkReadiness();

  assert.equal(readiness.enabled, false);
  assert.equal(readiness.packageName, "@openai/agents");
  assert.equal(readiness.requiredZodMajor, 4);
  assert.equal(readiness.currentIntegration, "requestEditorJson");
});

