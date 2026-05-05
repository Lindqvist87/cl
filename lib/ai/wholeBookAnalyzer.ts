import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import { modelConfigForRole } from "@/lib/ai/modelConfig";
import type { WholeBookAnalysisResult } from "@/lib/ai/analysisTypes";
import { stubUsageLog } from "@/lib/ai/usage";

const WHOLE_BOOK_MODEL_TIMEOUT_MS = 60_000;
const MAX_CHAPTER_SUMMARIES = 80;
const MAX_CHAPTER_SUMMARY_CHARACTERS = 900;
const MAX_PROFILE_ITEMS = 12;
const MAX_PROFILE_STRING_CHARACTERS = 900;

type WholeBookInput = {
  manuscriptTitle: string;
  targetGenre?: string | null;
  targetAudience?: string | null;
  wordCount: number;
  chapterSummaries: Array<{
    chapterIndex: number;
    title: string;
    summary?: string | null;
    wordCount: number;
  }>;
  profile: Record<string, unknown>;
};

export async function analyzeWholeBook(input: WholeBookInput) {
  if (!hasEditorModelKey()) {
    const json = stubWholeBookAnalysis(input);
    return { json, rawText: JSON.stringify(json), model: "stub", usage: stubUsageLog() };
  }

  const bounded = boundedWholeBookInput(input);

  try {
    return await requestEditorJson<WholeBookAnalysisResult>({
      ...modelConfigForRole("wholeBookCompiler"),
      system: [
        "You are a senior acquisition-minded manuscript editor.",
        "Return strict JSON only.",
        "You are not given the full manuscript; use stored chapter summaries and profile metrics.",
        "State uncertainty when evidence is incomplete."
      ].join(" "),
      user: JSON.stringify(
        {
          task: "Analyze the whole manuscript from summaries and metrics.",
          requiredShape: {
            executiveSummary: "plain-language whole-book audit summary",
            commercialManuscriptScore: "0-100",
            premise: "premise diagnosis",
            genreFit: "genre fit diagnosis",
            targetReader: "target reader diagnosis",
            structure: "structure diagnosis",
            actMovement: "act movement diagnosis",
            characterArcs: "arc diagnosis",
            pacingCurve: "curve notes or JSON object",
            theme: "theme diagnosis",
            marketFit: "market fit diagnosis",
            topIssues: [
              {
                issueType: "premise | structure | pacing | character | prose | market | theme",
                severity: "1-5",
                confidence: "0-1",
                problem: "specific issue",
                evidence: "summary/profile evidence",
                recommendation: "concrete recommendation",
                rewriteInstruction: "direct rewrite instruction"
              }
            ],
            valueRaisingEdits: ["top value-raising edits"]
          },
          manuscript: {
            title: bounded.manuscriptTitle,
            targetGenre: bounded.targetGenre,
            targetAudience: bounded.targetAudience,
            wordCount: bounded.wordCount
          },
          chapterSummaries: bounded.chapterSummaries,
          profile: bounded.profile,
          limits: {
            topIssues: 20,
            valueRaisingEdits: 10,
            sourceChapterCount: input.chapterSummaries.length,
            includedChapterSummaryCount: bounded.chapterSummaries.length,
            maxChapterSummaryCharacters: MAX_CHAPTER_SUMMARY_CHARACTERS
          }
        },
        null,
        2
      ),
      retries: 0,
      timeoutMs: WHOLE_BOOK_MODEL_TIMEOUT_MS
    });
  } catch (error) {
    const json = stubWholeBookAnalysis(input, modelFallbackReason(error));
    return {
      json,
      rawText: JSON.stringify(json),
      model: "system-fallback",
      usage: stubUsageLog()
    };
  }
}

function stubWholeBookAnalysis(
  input: WholeBookInput,
  fallbackReason?: string
): WholeBookAnalysisResult {
  const liveFallback = fallbackReason
    ? ` Live whole-book analysis could not complete inside the safe import window: ${fallbackReason}`
    : "";

  return {
    executiveSummary: `${input.manuscriptTitle} has ${input.wordCount.toLocaleString()} words across ${input.chapterSummaries.length} chapters. This whole-book audit is a deterministic fallback until live analysis completes.${liveFallback}`,
    commercialManuscriptScore: 50,
    premise: "Pending live model analysis.",
    genreFit: input.targetGenre
      ? `Target genre noted as ${input.targetGenre}; fit pending live analysis.`
      : "Target genre not set.",
    targetReader: input.targetAudience ?? "Target audience not set.",
    structure: "Chapter structure was parsed and stored.",
    actMovement: "Act movement pending live analysis.",
    characterArcs: "Character arcs pending live analysis.",
    pacingCurve: input.profile.pacingCurve ?? [],
    theme: "Theme pending live analysis.",
    marketFit: "Market fit requires trend and corpus comparison.",
    topIssues: [
      {
        issueType: "configuration",
        severity: 1,
        confidence: 1,
        problem: "Live whole-book analysis is not configured.",
        evidence: fallbackReason
          ? `Pipeline has stored chapter summaries and profile metrics. ${fallbackReason}`
          : "Pipeline has stored chapter summaries and profile metrics.",
        recommendation: fallbackReason
          ? "Review final-stage model settings and rerun the full pipeline when live synthesis is available."
          : "Set OPENAI_API_KEY and rerun the full pipeline.",
        rewriteInstruction: "Do not make major structural changes from stub output alone."
      }
    ],
    valueRaisingEdits: ["Run live analysis before prioritizing revision spend."]
  };
}

function boundedWholeBookInput(input: WholeBookInput): WholeBookInput {
  return {
    ...input,
    manuscriptTitle: boundedText(input.manuscriptTitle, 240),
    targetGenre: nullableBoundedText(input.targetGenre, 120),
    targetAudience: nullableBoundedText(input.targetAudience, 160),
    chapterSummaries: representativeChapterSummaries(input.chapterSummaries),
    profile: compactJsonRecord(input.profile)
  };
}

function representativeChapterSummaries(
  summaries: WholeBookInput["chapterSummaries"]
) {
  if (summaries.length <= MAX_CHAPTER_SUMMARIES) {
    return summaries.map(compactChapterSummary);
  }

  const selected: WholeBookInput["chapterSummaries"] = [];
  const seen = new Set<number>();
  const lastIndex = summaries.length - 1;

  for (let index = 0; index < MAX_CHAPTER_SUMMARIES; index += 1) {
    const sourceIndex = Math.round((index / (MAX_CHAPTER_SUMMARIES - 1)) * lastIndex);
    if (!seen.has(sourceIndex)) {
      seen.add(sourceIndex);
      selected.push(summaries[sourceIndex]);
    }
  }

  return selected.map(compactChapterSummary);
}

function compactChapterSummary(
  chapter: WholeBookInput["chapterSummaries"][number]
) {
  return {
    chapterIndex: chapter.chapterIndex,
    title: boundedText(chapter.title, 180),
    summary: nullableBoundedText(chapter.summary, MAX_CHAPTER_SUMMARY_CHARACTERS),
    wordCount: chapter.wordCount
  };
}

function compactJsonRecord(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["id", "manuscriptId", "createdAt", "updatedAt"].includes(key))
      .slice(0, MAX_PROFILE_ITEMS)
      .map(([key, item]) => [key, compactJsonValue(item)])
  );
}

function compactJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    return boundedText(value, MAX_PROFILE_STRING_CHARACTERS);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_PROFILE_ITEMS).map(compactJsonValue);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_PROFILE_ITEMS)
      .map(([key, item]) => [key, compactJsonValue(item)])
  );
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
