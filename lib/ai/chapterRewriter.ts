import {
  getRewriteModel,
  hasEditorModelKey,
  requestEditorJson
} from "@/lib/ai/editorModel";
import type { ChapterRewriteResult } from "@/lib/ai/analysisTypes";
import { stubUsageLog } from "@/lib/ai/usage";

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
    canonStatus?: string;
    acceptedRewriteExcerpt?: string;
    continuityNotes?: unknown;
  }>;
  previousSectionSummaries?: Array<{
    sectionIndex: number;
    summary?: string;
  }>;
  continuityRules: unknown;
  corpusPatternNotes?: Array<{
    pattern: string;
    source?: string;
    evidence?: string;
    suggestedUse?: string;
  }>;
  rewriteScope?: {
    type: "chapter" | "chunk";
    sectionIndex?: number;
    totalSections?: number;
    chunkIndex?: number;
  };
};

export async function rewriteChapter(input: ChapterRewriteInput) {
  if (!hasEditorModelKey()) {
    const json = stubChapterRewrite(input);
    return { json, rawText: JSON.stringify(json), model: "stub", usage: stubUsageLog() };
  }

  return requestEditorJson<ChapterRewriteResult>({
    model: getRewriteModel(),
    system: [
      "You rewrite one manuscript chapter at a time.",
      "Return strict JSON only.",
      "Preserve continuity and authorial voice.",
      "Do not rewrite the whole manuscript.",
      "Do not invent new facts unless unavoidable; warn when you do.",
      "Use corpus notes as summarized craft patterns only; never copy source books or imitate a named author directly."
    ].join(" "),
    user: JSON.stringify(
      {
        task:
          input.rewriteScope?.type === "chunk"
            ? "Rewrite this bounded chapter section according to the analysis, rewrite plan, and continuity ledger."
            : "Rewrite this single chapter according to the analysis and rewrite plan.",
        requiredShape: {
          rewrittenChapter: "complete rewritten chapter text",
          changeLog: [
            {
              change: "what changed",
              reason: "why it changed"
            }
          ],
          continuityNotes: "JSON object with carried-forward facts and dependencies",
          corpusInfluence: {
            patternsUsed: ["which summarized corpus patterns influenced the rewrite"],
            changed: ["what changed because of those patterns"],
            preserved: ["what original material or voice was preserved"],
            risksIntroduced: ["risks introduced by applying the pattern"]
          },
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
          rewriteScope: input.rewriteScope ?? { type: "chapter" },
          originalChapter: input.originalChapter,
          chapterAnalysis: input.chapterAnalysis
        },
        globalRewritePlan: input.globalRewritePlan,
        previousChapterSummaries: input.previousChapterSummaries,
        previousSectionSummaries: input.previousSectionSummaries ?? [],
        continuityRules: input.continuityRules,
        corpusPatternNotes: input.corpusPatternNotes ?? [],
        corpusPolicy: {
          receivesFullCorpusBooks: false,
          allowedContext:
            "short summarized BookProfile patterns, corpus comparison notes, and brief evidence labels only"
        }
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
    corpusInfluence: {
      patternsUsed: (input.corpusPatternNotes ?? []).map((note) => note.pattern),
      changed: [],
      preserved: ["Original chapter text was preserved by the placeholder."],
      risksIntroduced: []
    },
    inventedFactsWarnings: [
      "No new facts were invented by the deterministic placeholder."
    ],
    nextChapterImplications: []
  };
}
