import {
  getRewriteModel,
  hasEditorModelKey,
  requestEditorJson
} from "@/lib/ai/editorModel";
import type { ChapterRewriteResult } from "@/lib/ai/analysisTypes";

type ChapterRewriteInput = {
  manuscriptTitle: string;
  targetGenre?: string | null;
  targetAudience?: string | null;
  chapterTitle: string;
  chapterIndex: number;
  originalChapter: string;
  chapterAnalysis?: unknown;
  globalRewritePlan: unknown;
  previousChapterSummaries: Array<{
    title: string;
    summary?: string | null;
  }>;
  continuityRules: unknown;
};

export async function rewriteChapter(input: ChapterRewriteInput) {
  if (!hasEditorModelKey()) {
    const json = stubChapterRewrite(input);
    return { json, rawText: JSON.stringify(json), model: "stub" };
  }

  return requestEditorJson<ChapterRewriteResult>({
    model: getRewriteModel(),
    system: [
      "You rewrite one manuscript chapter at a time.",
      "Return strict JSON only.",
      "Preserve continuity and authorial voice.",
      "Do not rewrite the whole manuscript.",
      "Do not invent new facts unless unavoidable; warn when you do."
    ].join(" "),
    user: JSON.stringify(
      {
        task: "Rewrite this single chapter according to the analysis and rewrite plan.",
        requiredShape: {
          rewrittenChapter: "complete rewritten chapter text",
          changeLog: [
            {
              change: "what changed",
              reason: "why it changed"
            }
          ],
          continuityNotes: "JSON object with carried-forward facts and dependencies",
          inventedFactsWarnings: ["warnings"],
          nextChapterImplications: ["implications"]
        },
        manuscript: {
          title: input.manuscriptTitle,
          targetGenre: input.targetGenre,
          targetAudience: input.targetAudience
        },
        chapter: {
          title: input.chapterTitle,
          chapterIndex: input.chapterIndex,
          originalChapter: input.originalChapter,
          chapterAnalysis: input.chapterAnalysis
        },
        globalRewritePlan: input.globalRewritePlan,
        previousChapterSummaries: input.previousChapterSummaries,
        continuityRules: input.continuityRules
      },
      null,
      2
    )
  });
}

function stubChapterRewrite(input: ChapterRewriteInput): ChapterRewriteResult {
  return {
    rewrittenChapter: `[Rewrite draft placeholder]\n\n${input.originalChapter}`,
    changeLog: [
      {
        change: "No live rewrite performed.",
        reason: "OPENAI_API_KEY is not configured."
      }
    ],
    continuityNotes: {
      chapterIndex: input.chapterIndex,
      previousChapterCount: input.previousChapterSummaries.length
    },
    inventedFactsWarnings: [
      "No new facts were invented by the deterministic placeholder."
    ],
    nextChapterImplications: []
  };
}
