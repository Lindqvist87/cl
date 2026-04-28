import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import type { CorpusComparisonResult } from "@/lib/ai/analysisTypes";

type CorpusComparisonInput = {
  manuscriptTitle: string;
  targetGenre?: string | null;
  manuscriptProfile: Record<string, unknown>;
  benchmarkProfiles: Array<{
    title: string;
    author?: string | null;
    rightsStatus: string;
    genre?: string | null;
    profile: Record<string, unknown>;
  }>;
  similarChunks: Array<{
    bookTitle: string;
    author?: string | null;
    summary?: string | null;
    metrics?: unknown;
  }>;
};

export async function compareCorpus(input: CorpusComparisonInput) {
  if (!hasEditorModelKey()) {
    const json = stubCorpusComparison(input);
    return { json, rawText: JSON.stringify(json), model: "stub" };
  }

  return requestEditorJson<CorpusComparisonResult>({
    system: [
      "You compare a manuscript profile against legal/open literary corpus data.",
      "Return strict JSON only.",
      "Use only supplied profile metrics and public/open/license-safe metadata.",
      "Do not quote or imitate copyrighted books."
    ].join(" "),
    user: JSON.stringify(
      {
        task: "Compare manuscript against corpus benchmarks.",
        requiredShape: {
          summary: "benchmark summary",
          similarBooks: [
            {
              title: "book title",
              author: "author if supplied",
              reason: "evidence-based similarity",
              rightsStatus: "rights status"
            }
          ],
          structuralDivergences: ["evidence-based divergences"],
          ratioComparisons: "JSON object comparing dialogue/exposition/action ratios",
          openingPatternComparison: "opening pattern comparison",
          benchmarkNotes: ["specific benchmark notes"],
          findings: [
            {
              issueType: "corpus-benchmark",
              severity: "1-5",
              confidence: "0-1",
              problem: "specific benchmark issue",
              evidence: "profile or benchmark evidence",
              recommendation: "concrete recommendation",
              rewriteInstruction: "direct rewrite instruction"
            }
          ]
        },
        manuscriptTitle: input.manuscriptTitle,
        targetGenre: input.targetGenre,
        manuscriptProfile: input.manuscriptProfile,
        benchmarkProfiles: input.benchmarkProfiles,
        similarChunks: input.similarChunks
      },
      null,
      2
    )
  });
}

function stubCorpusComparison(input: CorpusComparisonInput): CorpusComparisonResult {
  return {
    summary:
      input.benchmarkProfiles.length > 0
        ? `Compared against ${input.benchmarkProfiles.length} stored corpus profiles using deterministic metrics.`
        : "No corpus profiles are available yet. Import public-domain, open-license, licensed, or private-reference texts to enable benchmarks.",
    similarBooks: input.benchmarkProfiles.slice(0, 5).map((book) => ({
      title: book.title,
      author: book.author ?? undefined,
      rightsStatus: book.rightsStatus,
      reason: "Closest available benchmark profile in the local corpus set."
    })),
    structuralDivergences: [],
    ratioComparisons: {
      benchmarkCount: input.benchmarkProfiles.length
    },
    openingPatternComparison: "Opening comparison requires corpus profiles.",
    benchmarkNotes: [
      "Corpus benchmarking is evidence-limited until the local corpus is populated."
    ],
    findings: []
  };
}
