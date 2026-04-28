import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import type { ChapterAnalysisResult } from "@/lib/ai/analysisTypes";
import { countWords } from "@/lib/text/wordCount";

type ChapterInput = {
  manuscriptTitle: string;
  targetGenre?: string | null;
  targetAudience?: string | null;
  chapterTitle: string;
  chapterIndex: number;
  text: string;
  chunkSummaries: string[];
};

export async function analyzeChapter(input: ChapterInput) {
  if (!hasEditorModelKey()) {
    const json = stubChapterAnalysis(input);
    return { json, rawText: JSON.stringify(json), model: "stub" };
  }

  return requestEditorJson<ChapterAnalysisResult>({
    system: [
      "You are a senior developmental editor auditing one chapter.",
      "Return strict JSON only.",
      "Use the supplied chapter text and chunk summaries only.",
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
              severity: "1-5",
              confidence: "0-1",
              problem: "specific problem",
              evidence: "brief evidence",
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
        issueType: "configuration",
        severity: 1,
        confidence: 1,
        problem: "Live chapter analysis is not configured.",
        evidence: `${input.chunkSummaries.length} chunk summaries available.`,
        recommendation: "Set OPENAI_API_KEY for the v2 chapter audit.",
        rewriteInstruction: "Use the stored source chapter until live analysis is available."
      }
    ]
  };
}
