import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import { modelConfigForRole } from "@/lib/ai/modelConfig";
import type { CorpusComparisonResult } from "@/lib/ai/analysisTypes";
import { stubUsageLog } from "@/lib/ai/usage";

export type BenchmarkProfileInput = {
  bookId?: string;
  title: string;
  author?: string | null;
  rightsStatus: string;
  genre?: string | null;
  language?: string | null;
  profile: Record<string, unknown>;
};

type BenchmarkProfileReference = Omit<BenchmarkProfileInput, "profile"> & {
  matchReason?: string;
};

export type CorpusComparisonInput = {
  manuscriptTitle: string;
  targetGenre?: string | null;
  manuscriptLanguage?: string | null;
  manuscriptProfile: Record<string, unknown>;
  wholeBookAudit?: Record<string, unknown>;
  benchmarkProfiles: BenchmarkProfileInput[];
  sameLanguageProfiles?: BenchmarkProfileReference[];
  sameGenreProfiles?: BenchmarkProfileReference[];
  selectedProfiles?: BenchmarkProfileReference[];
  rightsStatusCounts: Record<string, number>;
  chunkSimilarityBasis?: string;
  similarChunks: Array<{
    bookTitle: string;
    author?: string | null;
    rightsStatus: string;
    summary?: string | null;
    excerpt?: string | null;
    metrics?: unknown;
  }>;
};

export type CorpusComparisonLimits = {
  maxBenchmarkProfiles: number;
  maxProfileReferences: number;
  maxCorpusChunks: number;
  maxChunkSummaryCharacters: number;
  maxCorpusChunkExcerptCharacters: number;
  maxTotalCorpusExcerptCharacters: number;
  maxWholeBookNotes: number;
  maxProfileArrayItems: number;
  maxProfileStringCharacters: number;
  maxSerializedInputCharacters: number;
};

export type BoundedCorpusComparisonPackage = {
  input: CorpusComparisonInput;
  estimatedInputCharacters: number;
  includedProfileCount: number;
  includedChunkCount: number;
  includedWholeBookNoteCount: number;
  maxBudget: number;
  overBudget: boolean;
};

export const DEFAULT_CORPUS_COMPARISON_LIMITS: CorpusComparisonLimits = {
  maxBenchmarkProfiles: 10,
  maxProfileReferences: 10,
  maxCorpusChunks: 8,
  maxChunkSummaryCharacters: 900,
  maxCorpusChunkExcerptCharacters: 600,
  maxTotalCorpusExcerptCharacters: 3600,
  maxWholeBookNotes: 8,
  maxProfileArrayItems: 8,
  maxProfileStringCharacters: 900,
  maxSerializedInputCharacters: 90000
};

const CORPUS_COMPARISON_SYSTEM_PROMPT = [
  "You compare a manuscript profile against legal/open literary corpus data.",
  "Return strict JSON only.",
  "Use only supplied profile metrics and public/open/license-safe metadata.",
  "Do not quote or imitate copyrighted books.",
  "Do not instruct the system to rewrite exactly like a named author or book."
].join(" ");

const CORPUS_COMPARISON_REQUIRED_SHAPE = {
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
};

const PROFILE_PROMPT_FIELDS = [
  "wordCount",
  "chapterCount",
  "avgChapterWords",
  "medianChapterWords",
  "minChapterWords",
  "maxChapterWords",
  "avgSentenceLength",
  "dialogueRatio",
  "questionRatio",
  "exclamationRatio",
  "expositionRatio",
  "actionRatio",
  "introspectionRatio",
  "lexicalDensity",
  "paragraphLengthDistribution",
  "sentenceLengthDistribution",
  "repeatedTerms",
  "chapterLengthCurve",
  "povEstimate",
  "tenseEstimate",
  "openingHookType",
  "pacingCurve",
  "emotionalIntensityCurve",
  "conflictDensityCurve",
  "chapterEndingPatterns",
  "dominantSceneModes",
  "narrativeDistance",
  "styleFingerprint",
  "dialogueStyle",
  "expositionStyle",
  "genreMarkers",
  "tropeMarkers",
  "literaryCraftLessons",
  "deterministicMetrics",
  "aiMetrics"
];

export function buildBoundedCorpusComparisonInput(
  input: CorpusComparisonInput,
  limits: Partial<CorpusComparisonLimits> = {}
): BoundedCorpusComparisonPackage {
  const normalizedLimits = normalizeCorpusComparisonLimits(limits);
  let remainingExcerptCharacters = normalizedLimits.maxTotalCorpusExcerptCharacters;

  const benchmarkProfiles = input.benchmarkProfiles
    .slice(0, normalizedLimits.maxBenchmarkProfiles)
    .map((profile) => compactBenchmarkProfile(profile, normalizedLimits));
  const includedProfileIds = new Set(
    benchmarkProfiles
      .map((profile) => profile.bookId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
  const similarChunks = input.similarChunks
    .slice(0, normalizedLimits.maxCorpusChunks)
    .map((chunk) => {
      const excerpt = boundedText(
        chunk.excerpt,
        Math.min(
          normalizedLimits.maxCorpusChunkExcerptCharacters,
          remainingExcerptCharacters
        )
      );
      remainingExcerptCharacters -= excerpt.length;

      return {
        bookTitle: boundedText(chunk.bookTitle, 180),
        author: nullableBoundedText(chunk.author, 120),
        rightsStatus: chunk.rightsStatus,
        summary: nullableBoundedText(
          chunk.summary,
          normalizedLimits.maxChunkSummaryCharacters
        ),
        excerpt: excerpt.length > 0 ? excerpt : undefined,
        metrics: compactJsonValue(chunk.metrics, normalizedLimits)
      };
    });
  const wholeBookAudit = compactWholeBookAudit(input.wholeBookAudit, normalizedLimits);
  const boundedInput: CorpusComparisonInput = {
    manuscriptTitle: boundedText(input.manuscriptTitle, 240),
    targetGenre: nullableBoundedText(input.targetGenre, 120),
    manuscriptLanguage: nullableBoundedText(input.manuscriptLanguage, 40),
    manuscriptProfile: compactProfile(input.manuscriptProfile, normalizedLimits),
    wholeBookAudit: wholeBookAudit.audit,
    rightsStatusCounts: input.rightsStatusCounts,
    benchmarkProfiles,
    sameLanguageProfiles: compactProfileReferences(
      input.sameLanguageProfiles ?? [],
      includedProfileIds,
      normalizedLimits
    ),
    sameGenreProfiles: compactProfileReferences(
      input.sameGenreProfiles ?? [],
      includedProfileIds,
      normalizedLimits
    ),
    selectedProfiles: compactProfileReferences(
      input.selectedProfiles ?? [],
      includedProfileIds,
      normalizedLimits
    ),
    chunkSimilarityBasis: boundedText(
      input.chunkSimilarityBasis ?? "profile-filtered chunks",
      180
    ),
    similarChunks
  };
  const estimatedInputCharacters = estimateCorpusComparisonInputCharacters(
    boundedInput
  );

  return {
    input: boundedInput,
    estimatedInputCharacters,
    includedProfileCount: benchmarkProfiles.length,
    includedChunkCount: similarChunks.length,
    includedWholeBookNoteCount: wholeBookAudit.noteCount,
    maxBudget: normalizedLimits.maxSerializedInputCharacters,
    overBudget: estimatedInputCharacters > normalizedLimits.maxSerializedInputCharacters
  };
}

export function estimateCorpusComparisonInputCharacters(input: CorpusComparisonInput) {
  return CORPUS_COMPARISON_SYSTEM_PROMPT.length + serializeCorpusComparisonInput(input).length;
}

export function serializeCorpusComparisonInput(input: CorpusComparisonInput) {
  return JSON.stringify(buildCorpusComparisonUserPayload(input), null, 2);
}

export function isCorpusRequestTooLargeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /request too large|context(?: window| length| size)?|maximum context|too many tokens|token limit|TPM|tokens per minute/i.test(
    message
  );
}

export async function compareCorpus(
  input: CorpusComparisonInput,
  options: { retries?: number } = {}
) {
  if (!hasEditorModelKey()) {
    const json = stubCorpusComparison(input);
    return { json, rawText: JSON.stringify(json), model: "stub", usage: stubUsageLog() };
  }

  return requestEditorJson<CorpusComparisonResult>({
    ...modelConfigForRole("wholeBookCompiler"),
    system: CORPUS_COMPARISON_SYSTEM_PROMPT,
    user: serializeCorpusComparisonInput(input),
    retries: options.retries
  });
}

function buildCorpusComparisonUserPayload(input: CorpusComparisonInput) {
  return {
    task: "Compare manuscript against corpus benchmarks.",
    requiredShape: CORPUS_COMPARISON_REQUIRED_SHAPE,
    manuscriptTitle: input.manuscriptTitle,
    targetGenre: input.targetGenre,
    manuscriptLanguage: input.manuscriptLanguage,
    manuscriptProfile: input.manuscriptProfile,
    wholeBookAudit: input.wholeBookAudit ?? {},
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
  };
}

function normalizeCorpusComparisonLimits(limits: Partial<CorpusComparisonLimits>) {
  return { ...DEFAULT_CORPUS_COMPARISON_LIMITS, ...limits };
}

function compactBenchmarkProfile(
  profile: BenchmarkProfileInput,
  limits: CorpusComparisonLimits
): BenchmarkProfileInput {
  return {
    bookId: profile.bookId,
    title: boundedText(profile.title, 180),
    author: nullableBoundedText(profile.author, 120),
    rightsStatus: profile.rightsStatus,
    genre: nullableBoundedText(profile.genre, 120),
    language: nullableBoundedText(profile.language, 40),
    profile: compactProfile(profile.profile, limits)
  };
}

function compactProfileReferences(
  profiles: BenchmarkProfileReference[],
  includedProfileIds: Set<string>,
  limits: CorpusComparisonLimits
): BenchmarkProfileReference[] {
  return profiles
    .filter((profile) => !profile.bookId || includedProfileIds.has(profile.bookId))
    .slice(0, limits.maxProfileReferences)
    .map((profile) => ({
      bookId: profile.bookId,
      title: boundedText(profile.title, 180),
      author: nullableBoundedText(profile.author, 120),
      rightsStatus: profile.rightsStatus,
      genre: nullableBoundedText(profile.genre, 120),
      language: nullableBoundedText(profile.language, 40),
      matchReason:
        typeof profile.matchReason === "string"
          ? boundedText(profile.matchReason, 180)
          : undefined
    }));
}

function compactProfile(
  profile: Record<string, unknown>,
  limits: CorpusComparisonLimits
) {
  const compact: Record<string, unknown> = {};

  for (const field of PROFILE_PROMPT_FIELDS) {
    if (profile[field] !== undefined && profile[field] !== null) {
      compact[field] = compactJsonValue(profile[field], limits);
    }
  }

  return compact;
}

function compactWholeBookAudit(
  value: unknown,
  limits: CorpusComparisonLimits
): { audit: Record<string, unknown>; noteCount: number } {
  const record = toRecord(value);
  const topIssues = arrayValue(record.topIssues)
    .slice(0, limits.maxWholeBookNotes)
    .map((issue) => {
      const issueRecord = toRecord(issue);
      return {
        severity: issueRecord.severity,
        problem: boundedText(issueRecord.problem, 500),
        evidence: boundedText(issueRecord.evidence, 500),
        recommendation: boundedText(issueRecord.recommendation, 500)
      };
    });
  const remainingNotes = Math.max(limits.maxWholeBookNotes - topIssues.length, 0);
  const valueRaisingEdits = arrayValue(record.valueRaisingEdits)
    .filter((item): item is string => typeof item === "string")
    .slice(0, remainingNotes)
    .map((item) => boundedText(item, 500));

  return {
    audit: {
      executiveSummary: boundedText(record.executiveSummary, 1400),
      premise: boundedText(record.premise, 700),
      genreFit: boundedText(record.genreFit, 700),
      marketFit: boundedText(record.marketFit, 700),
      topIssues,
      valueRaisingEdits
    },
    noteCount: topIssues.length + valueRaisingEdits.length
  };
}

function compactJsonValue(value: unknown, limits: CorpusComparisonLimits): unknown {
  if (typeof value === "string") {
    return boundedText(value, limits.maxProfileStringCharacters);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, limits.maxProfileArrayItems)
      .map((item) => compactJsonValue(item, limits));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, limits.maxProfileArrayItems)
      .map(([key, item]) => [key, compactJsonValue(item, limits)])
  );
}

function nullableBoundedText(value: unknown, maxCharacters: number) {
  if (typeof value !== "string") {
    return value === null ? null : undefined;
  }

  return boundedText(value, maxCharacters);
}

function boundedText(value: unknown, maxCharacters: number) {
  if (typeof value !== "string" || maxCharacters <= 0) {
    return "";
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxCharacters) {
    return normalized;
  }

  if (maxCharacters <= 3) {
    return normalized.slice(0, maxCharacters);
  }

  return normalized.slice(0, maxCharacters - 3).trimEnd() + "...";
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
