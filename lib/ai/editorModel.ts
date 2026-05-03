import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { env } from "@/lib/env";
import {
  getOpenAIClient,
  hasOpenAIKey
} from "@/lib/analysis/openai";
import {
  auditModel,
  auditReasoningEffort,
  chiefEditorModel,
  chiefEditorReasoningEffort,
  localEditorModel,
  localEditorReasoningEffort,
  sectionEditorModel,
  sectionEditorReasoningEffort,
  type ReasoningEffort
} from "@/lib/ai/modelConfig";
import { usageLogFromOpenAIUsage, type AiUsageLog } from "@/lib/ai/usage";

export const EDITOR_PROMPT_VERSION = "editor-v2-1";

type JsonRequest = {
  system: string;
  user: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  temperature?: number;
  retries?: number;
};

export type EditorJsonResult<T> = {
  json: T;
  rawText: string;
  model: string;
  usage?: AiUsageLog;
};

export function getAuditModel() {
  return auditModel;
}

export function getLocalEditorModel() {
  return localEditorModel;
}

export function getRewriteModel() {
  return chiefEditorModel;
}

export function getSectionEditorModel() {
  return sectionEditorModel;
}

export function getChiefEditorModel() {
  return chiefEditorModel;
}

export function getAuditReasoningEffort() {
  return auditReasoningEffort;
}

export function getLocalEditorReasoningEffort() {
  return localEditorReasoningEffort;
}

export function getChiefEditorReasoningEffort() {
  return chiefEditorReasoningEffort;
}

export function getSectionEditorReasoningEffort() {
  return sectionEditorReasoningEffort;
}

export function getEditorModel() {
  return getAuditModel();
}

export function hasEditorModelKey() {
  return hasOpenAIKey();
}

export async function requestEditorJson<T>({
  system,
  user,
  model = auditModel,
  reasoningEffort = auditReasoningEffort,
  temperature,
  retries = 2
}: JsonRequest): Promise<EditorJsonResult<T>> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      const requestBody = {
        model,
        reasoning_effort: reasoningEffort,
        ...(temperature === undefined ? {} : { temperature }),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      };
      const completion = await getOpenAIClient().chat.completions.create(
        requestBody as unknown as ChatCompletionCreateParamsNonStreaming
      );

      const rawText = completion.choices[0]?.message.content ?? "{}";

      return {
        json: JSON.parse(rawText) as T,
        rawText,
        model,
        usage: usageLogFromOpenAIUsage(completion.usage, model)
      };
    } catch (error) {
      lastError = error;
      console.warn("Editor model request failed", {
        model,
        attempt: attempt + 1,
        message: error instanceof Error ? error.message : String(error)
      });

      if (attempt === retries) {
        break;
      }

      await sleep(300 * 2 ** attempt);
      attempt += 1;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Editor model request failed.");
}

export async function createEmbedding(input: string) {
  const response = await getOpenAIClient().embeddings.create({
    model: env.OPENAI_EMBEDDING_MODEL,
    input
  });

  return response.data[0]?.embedding ?? [];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
