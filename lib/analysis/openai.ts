import OpenAI from "openai";
import { env } from "@/lib/env";
import {
  auditModel,
  auditReasoningEffort,
  type ReasoningEffort
} from "@/lib/ai/modelConfig";

export type OpenAIClient = Pick<OpenAI, "chat" | "embeddings">;

let client: OpenAIClient | undefined;
let clientOverride: OpenAIClient | undefined;

export function getConfiguredModel(fallback = auditModel) {
  return fallback;
}

export function hasOpenAIKey() {
  return Boolean(clientOverride || env.OPENAI_API_KEY);
}

export function getOpenAIClient() {
  if (clientOverride) {
    return clientOverride;
  }

  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  client ??= new OpenAI({
    apiKey: env.OPENAI_API_KEY
  });

  return client;
}

export function setOpenAIClientForTest(openAIClient: OpenAIClient | undefined) {
  const previous = clientOverride;
  clientOverride = openAIClient;

  return () => {
    clientOverride = previous;
  };
}

export async function requestStructuredJson<T>({
  system,
  user,
  model = auditModel,
  reasoningEffort = auditReasoningEffort,
  temperature
}: {
  system: string;
  user: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  temperature?: number;
}): Promise<{ json: T; rawText: string; model: string }> {
  const completion = await getOpenAIClient().chat.completions.create({
    model,
    reasoning_effort: reasoningEffort,
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
}
