import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import { modelConfigForRole } from "@/lib/ai/modelConfig";
import type { TrendComparisonResult } from "@/lib/ai/analysisTypes";
import { stubUsageLog } from "@/lib/ai/usage";

const TREND_MODEL_TIMEOUT_MS = 30_000;
const MAX_TREND_SIGNALS = 40;
const MAX_TREND_TEXT_CHARACTERS = 700;

type TrendComparisonInput = {
  manuscriptTitle: string;
  targetGenre?: string | null;
  targetAudience?: string | null;
  wholeBookSummary?: string | null;
  trendSignals: Array<{
    source: string;
    title?: string | null;
    author?: string | null;
    genre?: string | null;
    category?: string | null;
    rank?: number | null;
    listName?: string | null;
    signalDate?: Date | string | null;
    description?: string | null;
    blurb?: string | null;
    reviewSnippet?: string | null;
  }>;
};

export async function compareTrends(input: TrendComparisonInput) {
  if (!hasEditorModelKey()) {
    const json = stubTrendComparison(input);
    return { json, rawText: JSON.stringify(json), model: "stub", usage: stubUsageLog() };
  }

  const bounded = boundedTrendInput(input);

  try {
    return await requestEditorJson<TrendComparisonResult>({
      ...modelConfigForRole("wholeBookCompiler"),
      system: [
        "You are a careful publishing trend analyst.",
        "Return strict JSON only.",
        "Use metadata and public trend signals only, not copyrighted full text.",
        "Trend signals are metadata/context only; do not derive prose, scene, or plot changes from trends alone.",
        "Never claim certainty where the supplied signals are weak."
      ].join(" "),
      user: JSON.stringify(
        {
          task: "Compare manuscript positioning against supplied trend signals.",
          requiredShape: {
            summary: "trend comparison summary with uncertainty",
            signalStrength: "weak | moderate | strong",
            dominantTropes: ["trope or positioning signals"],
            positioningNotes: ["specific positioning notes"],
            marketOpportunity: ["opportunities grounded in signals"],
            marketRisk: ["risks grounded in signals"],
            findings: [
              {
                issueType: "market-positioning | trope | category | audience | signal-quality",
                severity: "1-5",
                confidence: "0-1",
                problem: "specific market issue",
                evidence: "trend signal evidence",
                recommendation: "positioning/category recommendation",
                rewriteInstruction: "optional positioning-only context; no plot or prose command"
              }
            ]
          },
          manuscript: {
            title: bounded.manuscriptTitle,
            targetGenre: bounded.targetGenre,
            targetAudience: bounded.targetAudience,
            wholeBookSummary: bounded.wholeBookSummary
          },
          trendSignals: bounded.trendSignals,
          limits: {
            sourceSignalCount: input.trendSignals.length,
            includedSignalCount: bounded.trendSignals.length,
            maxTrendTextCharacters: MAX_TREND_TEXT_CHARACTERS
          }
        },
        null,
        2
      ),
      retries: 0,
      timeoutMs: TREND_MODEL_TIMEOUT_MS
    });
  } catch (error) {
    const json = stubTrendComparison(input, modelFallbackReason(error));
    return {
      json,
      rawText: JSON.stringify(json),
      model: "system-fallback",
      usage: stubUsageLog()
    };
  }
}

function stubTrendComparison(
  input: TrendComparisonInput,
  fallbackReason?: string
): TrendComparisonResult {
  const strength =
    input.trendSignals.length >= 20
      ? "strong"
      : input.trendSignals.length >= 5
        ? "moderate"
        : "weak";

  return {
    summary: `${input.trendSignals.length} trend signals are stored for this comparison. Treat conclusions as ${strength} until more source data is imported.${
      fallbackReason
        ? ` Live trend comparison did not complete inside the safe import window: ${fallbackReason}`
        : ""
    }`,
    signalStrength: strength,
    dominantTropes: [],
    positioningNotes: [],
    marketOpportunity: [
      "Manual trend rows can be used immediately for category and positioning context."
    ],
    marketRisk: [
      "Trend certainty is limited by the number and freshness of imported signals."
    ],
    findings: []
  };
}

function boundedTrendInput(input: TrendComparisonInput): TrendComparisonInput {
  return {
    manuscriptTitle: boundedText(input.manuscriptTitle, 240),
    targetGenre: nullableBoundedText(input.targetGenre, 120),
    targetAudience: nullableBoundedText(input.targetAudience, 160),
    wholeBookSummary: nullableBoundedText(input.wholeBookSummary, 1200),
    trendSignals: input.trendSignals.slice(0, MAX_TREND_SIGNALS).map((signal) => ({
      source: boundedText(signal.source, 160),
      title: nullableBoundedText(signal.title, 180),
      author: nullableBoundedText(signal.author, 120),
      genre: nullableBoundedText(signal.genre, 120),
      category: nullableBoundedText(signal.category, 120),
      rank: signal.rank,
      listName: nullableBoundedText(signal.listName, 160),
      signalDate: signal.signalDate,
      description: nullableBoundedText(signal.description, MAX_TREND_TEXT_CHARACTERS),
      blurb: nullableBoundedText(signal.blurb, MAX_TREND_TEXT_CHARACTERS),
      reviewSnippet: nullableBoundedText(
        signal.reviewSnippet,
        MAX_TREND_TEXT_CHARACTERS
      )
    }))
  };
}

function nullableBoundedText(value: string | null | undefined, maxCharacters: number) {
  return typeof value === "string" ? boundedText(value, maxCharacters) : value;
}

function boundedText(value: unknown, maxCharacters: number) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxCharacters) {
    return normalized;
  }

  return normalized.slice(0, Math.max(0, maxCharacters - 3)).trimEnd() + "...";
}

function modelFallbackReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return boundedText(message || "model request failed", 220);
}
