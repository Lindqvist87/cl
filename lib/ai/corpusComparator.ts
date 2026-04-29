import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import type { CorpusComparisonResult } from "@/lib/ai/analysisTypes";
import { stubUsageLog } from "@/lib/ai/usage";

type BenchmarkProfileInput = {
  bookId?: string;
  title: string;
  author?: string | null;
  rightsStatus: string;
  genre?: string | null;
  language?: string | null;
  profile: Record<string, unknown>;
};

type CorpusComparisonInput = {
  manuscriptTitle: string;
  targetGenre?: string | null;
  manuscriptLanguage?: string | null;
  manuscriptProfile: Record<string, unknown>;
  benchmarkProfiles: BenchmarkProfileInput[];
  sameLanguageProfiles?: BenchmarkProfileInput[];
  sameGenreProfiles?: BenchmarkProfileInput[];
  selectedProfiles?: BenchmarkProfileInput[];
  rightsStatusCounts: Record<string, number>;
  chunkSimilarityBasis?: string;
  similarChunks: Array<{
    bookTitle: string;
    author?: string | null;
    rightsStatus: string;
    summary?: string | null;
    metrics?: unknown;
  }>;
};

export async function compareCorpus(input: CorpusComparisonInput) {
  if (!hasEditorModelKey()) {
    const json = stubCorpusComparison(input);
    return { json, rawText: JSON.stringify(json), model: "stub", usage: stubUsageLog() };
  }

  return requestEditorJson<CorpusComparisonResult>({
    system: [
      "You compare a manuscript profile against legal/open literary corpus data.",
      "Return strict JSON only.",
      "Use only supplied profile metrics and public/open/license-safe metadata.",
      "Do not quote or imitate copyrighted books.",
      "Do not instruct the system to rewrite exactly like a named author or book."
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
          resemblanceNotes: ["where the manuscript resembles benchmark patterns"],
          usefulDivergences: ["divergences that help the manuscript"],
          riskyDivergences: ["divergences that create craft or genre risk"],
          patternSuggestions: ["literary patterns that could strengthen the manuscript"],
          chapterLevelSuggestions: [
            {
              chapterIndex: "number or label",
              pattern: "summarized corpus pattern",
              suggestion: "concrete chapter-level change"
            }
          ],
          rewritePatternNotes: [
            "short, rights-safe notes suitable for rewrite prompts; no source-book passages"
          ],
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
        manuscriptLanguage: input.manuscriptLanguage,
        manuscriptProfile: input.manuscriptProfile,
        rightsPolicy: {
          profileBenchmarks:
            "Profiles are grouped by rights status and exclude UNKNOWN/METADATA_ONLY records.",
          chunkContext:
            "Chunk-level context is restricted to public-domain/open-license books.",
          styleLearning:
            "Learn craft patterns only. Do not copy source books, imitate a living author directly, or output long source passages."
        },
        rightsStatusCounts: input.rightsStatusCounts,
        benchmarkProfiles: input.benchmarkProfiles,
        sameLanguageProfiles: input.sameLanguageProfiles ?? [],
        sameGenreProfiles: input.sameGenreProfiles ?? [],
        selectedProfiles: input.selectedProfiles ?? [],
        chunkSimilarityBasis: input.chunkSimilarityBasis ?? "profile-filtered chunks",
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
    resemblanceNotes: input.benchmarkProfiles.length
      ? ["Compared manuscript profile ratios and structure against benchmark Book DNA."]
      : [],
    usefulDivergences: [],
    riskyDivergences: [],
    patternSuggestions: input.sameGenreProfiles?.length
      ? ["Use same-genre Book DNA to tune opening conflict, tempo, and chapter endings."]
      : [],
    chapterLevelSuggestions: [],
    rewritePatternNotes: input.benchmarkProfiles.slice(0, 3).map((book) =>
      `${book.title}: benchmark pattern only; use summarized ${book.profile.openingHookType ?? "opening"} and pacing metrics, not source text.`
    ),
    findings: []
  };
}
