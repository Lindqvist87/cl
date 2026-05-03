import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import { modelConfigForRole } from "@/lib/ai/modelConfig";
import type { RewritePlanResult } from "@/lib/ai/analysisTypes";
import { stubUsageLog } from "@/lib/ai/usage";

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
    whyItMatters?: string | null;
    doThisNow?: string | null;
    evidence?: string | null;
    evidenceAnchors?: unknown;
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

  return requestEditorJson<RewritePlanResult>({
    ...modelConfigForRole("chiefEditor"),
    system: [
      "You are a senior rewrite strategist for a manuscript intelligence pipeline.",
      "Return strict JSON only.",
      "Separate findings from rewrite strategy.",
      "Use findings and evidence packs as the shared memory; do not invent source evidence.",
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
          title: input.manuscriptTitle,
          targetGenre: input.targetGenre,
          targetAudience: input.targetAudience
        },
        wholeBookAudit: input.wholeBookAudit,
        corpusComparison: input.corpusComparison,
        trendComparisonMetadataOnly: input.trendComparison,
        findings: input.findings,
        chapters: input.chapters
      },
      null,
      2
    )
  });
}

function stubRewritePlan(input: RewritePlannerInput): RewritePlanResult {
  return {
    globalStrategy:
      "Use stored findings to revise chapter by chapter while preserving the core premise, chronology, and authorial voice. Live strategic prioritization requires OPENAI_API_KEY.",
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
      note: "Requires imported trend signals for stronger positioning."
    }
  };
}
