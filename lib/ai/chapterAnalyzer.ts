import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import { modelConfigForRole } from "@/lib/ai/modelConfig";
import type { ChapterAnalysisResult } from "@/lib/ai/analysisTypes";
import { stubUsageLog } from "@/lib/ai/usage";
import { countWords } from "@/lib/text/wordCount";

type ChapterInput = {
  manuscriptTitle: string;
  targetGenre?: string | null;
  targetAudience?: string | null;
  chapterId?: string | null;
  chapterTitle: string;
  chapterIndex: number;
  text: string;
  chunkSummaries: string[];
};

export async function analyzeChapter(input: ChapterInput) {
  if (!hasEditorModelKey()) {
    const json = stubChapterAnalysis(input);
    return { json, rawText: JSON.stringify(json), model: "stub", usage: stubUsageLog() };
  }

  return requestEditorJson<ChapterAnalysisResult>({
    ...modelConfigForRole("localEditor"),
    system: [
      "You are the Close Reader / Local Editor auditing one chapter.",
      "Return strict JSON only.",
      "Use the supplied chapter text and chunk summaries only.",
      "Make chapter-level observations only; do not make final whole-book prioritization decisions.",
      "Every meaningful finding must include evidence anchors at chapter or excerpt level when possible.",
      "Do not imitate or recommend writing exactly like living authors."
    ].join(" "),
    user: JSON.stringify(
      {
        task: "Analyze one manuscript chapter.",
        requiredShape: {
          summary: "chapter summary",
          openingHook: "assessment of first page/hook",
          chapterPromise: "reader promise created by the chapter",
          conflict: "conflict state and pressure",
          pacing: "pacing diagnosis",
          emotionalMovement: "emotional arc",
          characterDevelopment: "character change or stasis",
          endingPull: "how strongly the ending pulls the reader onward",
          suggestedEdits: ["specific edits"],
          rewriteInstructions: ["direct instructions for chapter rewrite"],
          findings: [
            {
              issueType: "opening | conflict | pacing | character | ending | continuity | style",
              problemTitle: "short specific title",
              problemType: "specific editorial category",
              severity: "1-5",
              priority: "1-5 editorial urgency",
              confidence: "0-1",
              problem: "specific problem",
              whyItMatters: "why this matters for the reader",
              doThisNow: "small concrete next edit",
              scope: "chapter",
              evidence: "brief evidence summary",
              sourceTextExcerpt: "exact short excerpt if available",
              evidenceReason: "why this excerpt supports the finding",
              evidenceAnchors: [
                {
                  chapterId: input.chapterId,
                  granularity: "chapter",
                  sourceTextExcerpt: "short excerpt if available",
                  reason: "why this supports the finding"
                }
              ],
              recommendation: "concrete recommendation",
              rewriteInstruction: "direct rewrite instruction"
            }
          ]
        },
        manuscript: {
          title: input.manuscriptTitle,
          targetGenre: input.targetGenre,
          targetAudience: input.targetAudience
        },
        chapter: {
          title: input.chapterTitle,
          chapterIndex: input.chapterIndex,
          chapterId: input.chapterId,
          text: input.text,
          chunkSummaries: input.chunkSummaries
        }
      },
      null,
      2
    )
  });
}

function stubChapterAnalysis(input: ChapterInput): ChapterAnalysisResult {
  const wordCount = countWords(input.text);

  return {
    summary: `${input.chapterTitle} contains ${wordCount} words. Live chapter audit is pending OpenAI configuration.`,
    openingHook: "Stub assessment: hook requires live analysis.",
    chapterPromise: "Stub assessment: reader promise pending.",
    conflict: "Stub assessment: conflict pending.",
    pacing: "Stub assessment: pacing pending.",
    emotionalMovement: "Stub assessment: emotional movement pending.",
    characterDevelopment: "Stub assessment: character development pending.",
    endingPull: "Stub assessment: ending pull pending.",
    suggestedEdits: ["Configure OPENAI_API_KEY and rerun the pipeline."],
    rewriteInstructions: ["Preserve continuity and authorial voice."],
    findings: [
      {
        problemTitle: "Chapter model not configured",
        problemType: "configuration",
        issueType: "configuration",
        severity: 1,
        priority: 1,
        confidence: 1,
        problem: "Live chapter analysis is not configured.",
        whyItMatters: "Without live analysis, this chapter row only verifies storage.",
        doThisNow: "Set OPENAI_API_KEY for the v2 chapter audit.",
        scope: "chapter",
        evidence: `${input.chunkSummaries.length} chunk summaries available.`,
        sourceTextExcerpt: input.text.slice(0, 220),
        evidenceReason: "The excerpt identifies the chapter text covered by this stub finding.",
        evidenceAnchors: [
          {
            chapterId: input.chapterId ?? null,
            granularity: "chapter",
            sourceTextExcerpt: input.text.slice(0, 220),
            reason: "The stub can only anchor to the supplied chapter context."
          }
        ],
        recommendation: "Set OPENAI_API_KEY for the v2 chapter audit.",
        rewriteInstruction: "Use the stored source chapter until live analysis is available."
      }
    ]
  };
}
