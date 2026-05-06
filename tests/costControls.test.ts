import test from "node:test";
import assert from "node:assert/strict";
import { requestBudgetForRole } from "../lib/ai/costControls";

test("background specialist roles are batch and flex eligible", () => {
  const budget = requestBudgetForRole({
    role: "sceneAnalysis",
    reasoningEffort: "medium"
  });

  assert.equal(budget.metadata.costControl, "background");
  assert.equal(budget.metadata.batchEligible, true);
  assert.equal(budget.metadata.flexEligible, true);
});

test("chief editor stays on final-pass controls", () => {
  const budget = requestBudgetForRole({
    role: "chiefEditor",
    reasoningEffort: "xhigh"
  });

  assert.equal(budget.metadata.costControl, "final");
  assert.equal(budget.metadata.batchEligible, false);
  assert.equal(budget.metadata.flexEligible, false);
});

