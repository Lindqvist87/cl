import test from "node:test";
import assert from "node:assert/strict";
import { reconcileCheckpointWithDurableState } from "../lib/pipeline/durableReconciliation";

test("durable reconciliation reopens summarizeChunks when checkpoint is on stale audits", () => {
  const reconciliation = reconcileCheckpointWithDurableState({
    checkpoint: {
      completedSteps: [
        "parseAndNormalizeManuscript",
        "splitIntoChapters",
        "splitIntoChunks",
        "createEmbeddingsForChunks",
        "summarizeChunks",
        "summarizeChapters",
        "createManuscriptProfile"
      ],
      currentStep: "runChapterAudits",
      stepMetadata: {
        runChapterAudits: {
          audited: 72,
          remaining: 76,
          complete: false
        }
      }
    },
    chunkAnalysis: {
      total: 139,
      summarized: 16,
      outputCount: 16,
      summaryRowCount: 16,
      remaining: 123
    }
  });

  assert.equal(reconciliation.checkpointPhase, "runChapterAudits");
  assert.equal(reconciliation.durablePhase, "summarizeChunks");
  assert.equal(reconciliation.reopenFromStep, "summarizeChunks");
  assert.equal(reconciliation.chunkAnalysisTotal, 139);
  assert.equal(reconciliation.chunkAnalysisCompleted, 16);
  assert.equal(reconciliation.checkpoint.currentStep, "summarizeChunks");
  assert.deepEqual(reconciliation.checkpoint.completedSteps, [
    "parseAndNormalizeManuscript",
    "splitIntoChapters",
    "splitIntoChunks",
    "createEmbeddingsForChunks"
  ]);
  assert.deepEqual(reconciliation.checkpoint.stepMetadata?.summarizeChunks, {
    summarized: 16,
    total: 139,
    remaining: 123,
    complete: false
  });
});