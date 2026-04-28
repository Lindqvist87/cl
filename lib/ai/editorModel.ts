import { env } from "@/lib/env";
import { getOpenAIClient } from "@/lib/analysis/openai";

export const EDITOR_PROMPT_VERSION = "editor-v2-1";

type JsonRequest = {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  retries?: number;
};

export function getAuditModel() {
  return env.OPENAI_AUDIT_MODEL || env.OPENAI_EDITOR_MODEL || "gpt-5.4-mini";
}

export function getRewriteModel() {
  return env.OPENAI_REWRITE_MODEL || "gpt-5.5";
}

export function getEditorModel() {
  return getAuditModel();
}

export function hasEditorModelKey() {
  return Boolean(env.OPENAI_API_KEY);
}

export async function requestEditorJson<T>({
  system,
  user,
  model = getAuditModel(),
  temperature,
  retries = 2
}: JsonRequest): Promise<{ json: T; rawText: string; model: string }> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      const completion = await getOpenAIClient().chat.completions.create({
        model,
        ...(temperature === undefined ? {} : { temperature }),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      });

      const rawText = completion.choices[0]?.message.content ?? "{}";

      return {
        json: JSON.parse(rawText) as T,
        rawText,
        model
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
