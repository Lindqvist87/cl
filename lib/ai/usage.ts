export type AiUsageLog = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
  cost: {
    currency: "USD";
    estimatedUsd: number | null;
    basis: string;
  };
};

type OpenAIUsageLike = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
};

export function usageLogFromOpenAIUsage(
  usage: unknown,
  model: string
): AiUsageLog | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const value = usage as OpenAIUsageLike;
  const promptTokens = finiteTokenCount(value.prompt_tokens);
  const completionTokens = finiteTokenCount(value.completion_tokens);
  const totalTokens = finiteTokenCount(value.total_tokens);

  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
    return undefined;
  }

  return {
    model,
    promptTokens,
    completionTokens,
    totalTokens: totalTokens || promptTokens + completionTokens,
    cachedPromptTokens: finiteOptionalTokenCount(
      value.prompt_tokens_details?.cached_tokens
    ),
    reasoningTokens: finiteOptionalTokenCount(
      value.completion_tokens_details?.reasoning_tokens
    ),
    cost: estimateCost(model, promptTokens, completionTokens)
  };
}

export function stubUsageLog(model = "stub"): AiUsageLog {
  return {
    model,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: {
      currency: "USD",
      estimatedUsd: 0,
      basis: "No external model call."
    }
  };
}

export function aggregateUsageLogs(
  model: string,
  logs: Array<AiUsageLog | undefined>
): AiUsageLog | undefined {
  const present = logs.filter(Boolean) as AiUsageLog[];
  if (present.length === 0) {
    return undefined;
  }

  const promptTokens = sum(present.map((log) => log.promptTokens));
  const completionTokens = sum(present.map((log) => log.completionTokens));
  const totalTokens = sum(present.map((log) => log.totalTokens));
  const cachedPromptTokens = optionalSum(
    present.map((log) => log.cachedPromptTokens)
  );
  const reasoningTokens = optionalSum(present.map((log) => log.reasoningTokens));
  const estimatedCosts = present.map((log) => log.cost.estimatedUsd);
  const hasUnknownCost = estimatedCosts.some((cost) => cost === null);

  return {
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    cachedPromptTokens,
    reasoningTokens,
    cost: {
      currency: "USD",
      estimatedUsd: hasUnknownCost
        ? null
        : sum(estimatedCosts.map((cost) => cost ?? 0)),
      basis: hasUnknownCost
        ? "One or more model calls do not have configured pricing."
        : "Sum of section-level model cost estimates."
    }
  };
}

export function withAiUsage<T extends Record<string, unknown>>(
  summary: T,
  usage?: AiUsageLog
) {
  return usage ? { ...summary, usage } : summary;
}

function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): AiUsageLog["cost"] {
  const inputRate = numberFromEnv("OPENAI_INPUT_COST_PER_MILLION_TOKENS_USD");
  const outputRate = numberFromEnv("OPENAI_OUTPUT_COST_PER_MILLION_TOKENS_USD");

  if (inputRate === undefined || outputRate === undefined) {
    return {
      currency: "USD",
      estimatedUsd: null,
      basis: `Token usage logged for ${model}; set OPENAI_INPUT_COST_PER_MILLION_TOKENS_USD and OPENAI_OUTPUT_COST_PER_MILLION_TOKENS_USD to estimate cost.`
    };
  }

  return {
    currency: "USD",
    estimatedUsd:
      (promptTokens / 1_000_000) * inputRate +
      (completionTokens / 1_000_000) * outputRate,
    basis:
      "Estimated from configured per-million input/output token rates; provider pricing may vary."
  };
}

function finiteTokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function finiteOptionalTokenCount(value: unknown) {
  const count = finiteTokenCount(value);
  return count > 0 ? count : undefined;
}

function numberFromEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function optionalSum(values: Array<number | undefined>) {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length > 0 ? sum(present) : undefined;
}
