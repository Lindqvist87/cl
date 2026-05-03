import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import { modelConfigForRole } from "@/lib/ai/modelConfig";
import type { TrendComparisonResult } from "@/lib/ai/analysisTypes";
import { stubUsageLog } from "@/lib/ai/usage";

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

  return requestEditorJson<TrendComparisonResult>({
    ...modelConfigForRole("sectionEditor"),
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
              problemTitle: "short specific title",
              problemType: "market-context",
              severity: "1-5",
              priority: "1-5 editorial urgency",
              confidence: "0-1",
              problem: "specific market issue",
              whyItMatters: "why this affects positioning or reader promise",
              doThisNow: "small concrete next edit",
              scope: "global",
              evidence: "trend signal evidence",
              evidenceReason: "why this trend evidence supports the finding",
              evidenceAnchors: [
                {
                  granularity: "manuscript",
                  sourceTextExcerpt: "trend summary or whole-book summary evidence",
                  reason: "why this supports the finding"
                }
              ],
              recommendation: "positioning/category recommendation",
              rewriteInstruction: "optional positioning-only context; no plot or prose command"
            }
          ]
        },
        manuscript: {
          title: input.manuscriptTitle,
          targetGenre: input.targetGenre,
          targetAudience: input.targetAudience,
          wholeBookSummary: input.wholeBookSummary
        },
        trendSignals: input.trendSignals
      },
      null,
      2
    )
  });
}

function stubTrendComparison(input: TrendComparisonInput): TrendComparisonResult {
  const strength =
    input.trendSignals.length >= 20
      ? "strong"
      : input.trendSignals.length >= 5
        ? "moderate"
        : "weak";

  return {
    summary: `${input.trendSignals.length} trend signals are stored for this comparison. Treat conclusions as ${strength} until more source data is imported.`,
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
