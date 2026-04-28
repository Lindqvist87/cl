import OpenAI from "openai";
import { env } from "@/lib/env";

const DEFAULT_AUDIT_MODEL = env.OPENAI_AUDIT_MODEL;

let client: OpenAI | undefined;

export function getConfiguredModel(fallback = DEFAULT_AUDIT_MODEL) {
  return fallback;
}

export function hasOpenAIKey() {
  return Boolean(env.OPENAI_API_KEY);
}

export function getOpenAIClient() {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  client ??= new OpenAI({
    apiKey: env.OPENAI_API_KEY
  });

  return client;
}

export async function requestStructuredJson<T>({
  system,
  user,
  model = DEFAULT_AUDIT_MODEL,
  temperature
}: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
}): Promise<{ json: T; rawText: string; model: string }> {
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
}
