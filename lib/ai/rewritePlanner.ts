import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import { modelConfigForRole } from "@/lib/ai/modelConfig";
import type { RewritePlanResult } from "@/lib/ai/analysisTypes";
import { stubUsageLog } from "@/lib/ai/usage";

const REWRITE_PLAN_MODEL_TIMEOUT_MS = 60_000;
const MAX_REWRITE_FINDINGS = 80;
const MAX_REWRITE_CHAPTER_SUMMARY_CHARACTERS = 260;
const MAX_REWRITE_ARRAY_ITEMS = 24;
const MAX_REWRITE_STRING_CHARACTERS = 900;

type RewritePlannerInput = {
  manuscriptTitle: string;
  targetGenre?: string | null;
  targetAudience?: string | null;
  wholeBookAudit?: unknown;
  corpusComparison?: unknown;
  trendComparison?: unknown;
  findings: Array<{
    issueType: string;
    severity: number;
    problem: string;
    recommendation: string;
    rewriteInstruction?: string | null;
  }>;
  chapters: Array<{
    id: string;
    chapterIndex: number;
    title: string;
    summary?: string | null;
    wordCount: number;
  }>;
};

export async function planRewrite(input: RewritePlannerInput) {
  if (!hasEditorModelKey()) {
    const json = stubRewritePlan(input);
    return { json, rawText: JSON.stringify(json), model: "stub", usage: stubUsageLog() };
  }

  const bounded = boundedRewriteInput(input);

  try {
    return await requestEditorJson<RewritePlanResult>({
      ...modelConfigForRole("chiefEditor"),
      system: [
        "You are a senior rewrite strategist for a manuscript intelligence pipeline.",
        "Return strict JSON only.",
        "Separate findings from rewrite strategy.",
        "Preserve the author's voice and continuity.",
        "Treat trend comparison as metadata/context only; do not turn trend signals into plot or prose instructions.",
        "Do not recommend copying or imitating copyrighted modern works."
      ].join(" "),
      user: JSON.stringify(
        {
          task: "Create a global rewrite plan.",
          requiredShape: {
            globalStrategy: "overall rewrite strategy",
            preserve: ["what to preserve"],
            change: ["what to change"],
            cut: ["what to cut"],
            moveEarlier: ["what to move earlier"],
            intensify: ["what to intensify"],
            chapterPlans: [
              {
                chapterId: "id",
                chapterIndex: "number",
                title: "title",
                plan: "chapter-specific rewrite plan",
                continuityDependencies: ["dependencies"],
                priority: "1-5"
              }
            ],
            continuityRules: ["rules"],
            styleRules: ["rules"],
            readerPromise: "reader promise",
            marketPositioning: "JSON object"
          },
          manuscript: {
            title: bounded.manuscriptTitle,
            targetGenre: bounded.targetGenre,
            targetAudience: bounded.targetAudience
          },
          wholeBookAudit: bounded.wholeBookAudit,
          corpusComparison: bounded.corpusComparison,
          trendComparisonMetadataOnly: bounded.trendComparison,
          findings: bounded.findings,
          chapters: bounded.chapters,
          limits: {
            sourceFindingCount: input.findings.length,
            includedFindingCount: bounded.findings.length,
            sourceChapterCount: input.chapters.length,
            maxChapterSummaryCharacters: MAX_REWRITE_CHAPTER_SUMMARY_CHARACTERS
          }
        },
        null,
        2
      ),
      retries: 0,
      timeoutMs: REWRITE_PLAN_MODEL_TIMEOUT_MS
    });
  } catch (error) {
    const json = stubRewritePlan(input, modelFallbackReason(error));
    return {
      json,
      rawText: JSON.stringify(json),
      model: "system-fallback",
      usage: stubUsageLog()
    };
  }
}

function stubRewritePlan(
  input: RewritePlannerInput,
  fallbackReason?: string
): RewritePlanResult {
  const fallbackSentence = fallbackReason
    ? ` Live rewrite planning did not complete inside the safe import window: ${fallbackReason}`
    : "";

  return {
    globalStrategy:
      `Use stored findings to revise chapter by chapter while preserving the core premise, chronology, and authorial voice. Live strategic prioritization requires OPENAI_API_KEY.${fallbackSentence}`,
    preserve: ["Authorial voice", "Established chronology", "Core character facts"],
    change: input.findings.slice(0, 5).map((finding) => finding.recommendation),
    cut: [],
    moveEarlier: [],
    intensify: [],
    chapterPlans: input.chapters.map((chapter) => ({
      chapterId: chapter.id,
      chapterIndex: chapter.chapterIndex,
      title: chapter.title,
      plan: "Stub plan: preserve source chapter and apply live findings when available.",
      priority: 1
    })),
    continuityRules: [
      "Do not invent new plot facts without flagging them.",
      "Carry forward names, timeline, setting, and relationships from prior summaries."
    ],
    styleRules: [
      "Preserve the author's sentence-level voice.",
      "Improve clarity without flattening distinctive phrasing."
    ],
    readerPromise: input.targetGenre
      ? `Deliver a clear ${input.targetGenre} reader promise.`
      : "Clarify the reader promise.",
    marketPositioning: {
      confidence: "weak",
      note: fallbackReason
        ? `Fallback plan generated after live model failure: ${fallbackReason}`
        : "Requires imported trend signals for stronger positioning."
    }
  };
}

function boundedRewriteInput(input: RewritePlannerInput): RewritePlannerInput {
  return {
    manuscriptTitle: boundedText(input.manuscriptTitle, 240),
    targetGenre: nullableBoundedText(input.targetGenre, 120),
    targetAudience: nullableBoundedText(input.targetAudience, 160),
    wholeBookAudit: compactJsonValue(input.wholeBookAudit),
    corpusComparison: compactJsonValue(input.corpusComparison),
    trendComparison: compactJsonValue(input.trendComparison),
    findings: input.findings.slice(0, MAX_REWRITE_FINDINGS).map((finding) => ({
      issueType: boundedText(finding.issueType, 80),
      severity: finding.severity,
      problem: boundedText(finding.problem, 500),
      recommendation: boundedText(finding.recommendation, 500),
      rewriteInstruction: nullableBoundedText(finding.rewriteInstruction, 500)
    })),
    chapters: input.chapters.map((chapter) => ({
      id: chapter.id,
      chapterIndex: chapter.chapterIndex,
      title: boundedText(chapter.title, 180),
      summary: nullableBoundedText(
        chapter.summary,
        MAX_REWRITE_CHAPTER_SUMMARY_CHARACTERS
      ),
      wordCount: chapter.wordCount
    }))
  };
}

function compactJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    return boundedText(value, MAX_REWRITE_STRING_CHARACTERS);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_REWRITE_ARRAY_ITEMS).map(compactJsonValue);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["id", "runId", "manuscriptId", "createdAt", "updatedAt"].includes(key))
      .slice(0, MAX_REWRITE_ARRAY_ITEMS)
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
