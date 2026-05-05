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
  modelConfigForRole,
  type ModelRole,
  type ReasoningEffort
} from "@/lib/ai/modelConfig";
import { usageLogFromOpenAIUsage, type AiUsageLog } from "@/lib/ai/usage";

export const EDITOR_PROMPT_VERSION = "editor-v2-1";

type JsonRequest = {
  system: string;
  user: string;
  role?: ModelRole;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  temperature?: number;
  retries?: number;
  timeoutMs?: number;
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

export function getRewriteModel() {
  return chiefEditorModel;
}

export function getChiefEditorModel() {
  return chiefEditorModel;
}

export function getAuditReasoningEffort() {
  return auditReasoningEffort;
}

export function getChiefEditorReasoningEffort() {
  return chiefEditorReasoningEffort;
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
  role,
  model,
  reasoningEffort,
  temperature,
  retries = 2,
  timeoutMs
}: JsonRequest): Promise<EditorJsonResult<T>> {
  const roleConfig = role ? modelConfigForRole(role) : undefined;
  const resolvedModel = model ?? roleConfig?.model ?? auditModel;
  const resolvedReasoningEffort =
    reasoningEffort ?? roleConfig?.reasoningEffort ?? auditReasoningEffort;
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      const completion = await getOpenAIClient().chat.completions.create(
        {
          model: resolvedModel,
          reasoning_effort: resolvedReasoningEffort as never,
          ...(temperature === undefined ? {} : { temperature }),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        },
        typeof timeoutMs === "number" && timeoutMs > 0
          ? { timeout: timeoutMs }
          : undefined
      );

      const rawText = completion.choices[0]?.message.content ?? "{}";

      return {
        json: JSON.parse(rawText) as T,
        rawText,
        model: resolvedModel,
        usage: usageLogFromOpenAIUsage(completion.usage, resolvedModel)
      };
    } catch (error) {
      lastError = error;
      console.warn("Editor model request failed", {
        model: resolvedModel,
        reasoningEffort: resolvedReasoningEffort,
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

  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Editor model request failed for model ${resolvedModel} with reasoning_effort ${resolvedReasoningEffort}: ${message}`,
    { cause: lastError }
  );
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
