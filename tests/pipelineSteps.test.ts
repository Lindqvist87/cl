import test from "node:test";
import assert from "node:assert/strict";
import {
  isStepComplete,
  markStepComplete,
  markStepStarted,
  normalizeCheckpoint,
  pipelineProgress
} from "../lib/pipeline/steps";

test("pipeline checkpoint helpers make steps idempotent", () => {
  const started = markStepStarted({}, "splitIntoChunks");
  assert.equal(started.currentStep, "splitIntoChunks");
  assert.equal(isStepComplete(started, "splitIntoChunks"), false);

  const completedOnce = markStepComplete(started, "splitIntoChunks");
  const completedTwice = markStepComplete(completedOnce, "splitIntoChunks");

  assert.equal(isStepComplete(completedTwice, "splitIntoChunks"), true);
  assert.deepEqual(completedTwice.completedSteps, ["splitIntoChunks"]);
});

test("pipeline progress ignores unknown checkpoint values", () => {
  const checkpoint = normalizeCheckpoint({
    completedSteps: ["splitIntoChunks", "unknown"]
  });
  const progress = pipelineProgress(checkpoint);

  assert.equal(progress.completed, 1);
  assert.equal(progress.total > 1, true);
});
