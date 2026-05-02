import test from "node:test";
import assert from "node:assert/strict";
import {
  auditModel,
  auditReasoningEffort,
  chiefEditorModel,
  chiefEditorReasoningEffort,
  resolveModelConfig
} from "../lib/ai/modelConfig";
import { analyzeManuscriptChunk } from "../lib/ai/chunkAnalyzer";
import { planRewrite } from "../lib/ai/rewritePlanner";
import {
  setOpenAIClientForTest,
  type OpenAIClient
} from "../lib/analysis/openai";

test("model config prefers role-specific env vars", () => {
  const config = resolveModelConfig({
    AUDIT_MODEL: "audit-env-model",
    AUDIT_REASONING_EFFORT: "low",
    CHIEF_EDITOR_MODEL: "chief-env-model",
    CHIEF_EDITOR_REASONING_EFFORT: "high",
    OPENAI_AUDIT_MODEL: "legacy-audit-model",
    OPENAI_REWRITE_MODEL: "legacy-rewrite-model"
  });

  assert.equal(config.auditModel, "audit-env-model");
  assert.equal(config.auditReasoningEffort, "low");
  assert.equal(config.chiefEditorModel, "chief-env-model");
  assert.equal(config.chiefEditorReasoningEffort, "high");
});

test("model config preserves safe fallbacks when role env vars are missing", () => {
  const defaultConfig = resolveModelConfig({});

  assert.equal(defaultConfig.auditModel, "gpt-5.4-mini");
  assert.equal(defaultConfig.auditReasoningEffort, "medium");
  assert.equal(defaultConfig.chiefEditorModel, "gpt-5.4");
  assert.equal(defaultConfig.chiefEditorReasoningEffort, "high");

  const legacyConfig = resolveModelConfig({
    OPENAI_AUDIT_MODEL: "legacy-audit-model",
    OPENAI_REWRITE_MODEL: "legacy-rewrite-model"
  });

  assert.equal(legacyConfig.auditModel, "legacy-audit-model");
  assert.equal(legacyConfig.chiefEditorModel, "legacy-rewrite-model");
});

test("invalid reasoning efforts fall back to safe defaults", () => {
  const config = resolveModelConfig({
    AUDIT_REASONING_EFFORT: "maximum",
    CHIEF_EDITOR_REASONING_EFFORT: "expensive"
  });

  assert.equal(config.auditReasoningEffort, "medium");
  assert.equal(config.chiefEditorReasoningEffort, "high");
});

test("audit calls use audit model configuration", async () => {
  const requests: ChatRequest[] = [];
  const restore = setOpenAIClientForTest(
    fakeOpenAIClient(requests, {
      summary: "Chunk summary.",
      sceneFunction: "Opening movement.",
      metrics: {
        tension: 0.4,
        exposition: 0.2,
        dialogue: 0.1,
        action: 0.5,
        introspection: 0.2,
        clarity: 0.8,
        hookStrength: 0.7,
        characterMovement: 0.3
      },
      possibleCuts: [],
      findings: []
    })
  );

  try {
    const result = await analyzeManuscriptChunk({
      manuscriptTitle: "Test Manuscript",
      targetGenre: "Fantasy",
      targetAudience: "Adult",
      chapterTitle: "Opening",
      chunkIndex: 1,
      text: "A door opens into trouble."
    });

    assert.equal(result.model, auditModel);
    assert.equal(requests[0].model, auditModel);
    assert.equal(requests[0].reasoning_effort, auditReasoningEffort);
  } finally {
    restore();
  }
});

test("chief editor calls use chief editor model configuration", async () => {
  const requests: ChatRequest[] = [];
  const restore = setOpenAIClientForTest(
    fakeOpenAIClient(requests, {
      globalStrategy: "Strengthen the central promise while preserving voice.",
      preserve: ["Voice"],
      change: ["Move conflict earlier"],
      cut: [],
      moveEarlier: [],
      intensify: [],
      chapterPlans: [],
      continuityRules: [],
      styleRules: [],
      readerPromise: "A clear fantasy promise.",
      marketPositioning: {}
    })
  );

  try {
    const result = await planRewrite({
      manuscriptTitle: "Test Manuscript",
      targetGenre: "Fantasy",
      targetAudience: "Adult",
      findings: [],
      chapters: []
    });

    assert.equal(result.model, chiefEditorModel);
    assert.equal(requests[0].model, chiefEditorModel);
    assert.equal(requests[0].reasoning_effort, chiefEditorReasoningEffort);
  } finally {
    restore();
  }
});

type ChatRequest = {
  model?: string;
  reasoning_effort?: string;
};

function fakeOpenAIClient(
  requests: ChatRequest[],
  jsonResponse: unknown
): OpenAIClient {
  return {
    chat: {
      completions: {
        create: async (request: ChatRequest) => {
          requests.push(request);
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(jsonResponse)
                }
              }
            ]
          };
        }
      }
    },
    embeddings: {
      create: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3] }]
      })
    }
  } as unknown as OpenAIClient;
}
