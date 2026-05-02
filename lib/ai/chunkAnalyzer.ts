import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import { modelConfigForRole } from "@/lib/ai/modelConfig";
import type { ChunkAnalysisResult } from "@/lib/ai/analysisTypes";
import { stubUsageLog } from "@/lib/ai/usage";
import { countWords } from "@/lib/text/wordCount";

type ChunkInput = {
  manuscriptTitle: string;
  targetGenre?: string | null;
  targetAudience?: string | null;
  chapterTitle: string;
  chunkIndex: number;
  text: string;
  previousSummary?: string | null;
};

export async function analyzeManuscriptChunk(input: ChunkInput) {
  if (!hasEditorModelKey()) {
    const json = stubChunkAnalysis(input);
    return { json, rawText: JSON.stringify(json), model: "stub", usage: stubUsageLog() };
  }

  return requestEditorJson<ChunkAnalysisResult>({
    ...modelConfigForRole("audit"),
    system: [
      "You are a senior manuscript editor analyzing one chunk in a resumable pipeline.",
      "Return strict JSON only.",
      "Use only the supplied manuscript chunk and context.",
      "Do not compare the prose to living authors or copyrighted modern books.",
      "Be concrete, evidence-led, and preserve the author's voice."
    ].join(" "),
    user: JSON.stringify(
      {
        task: "Analyze one manuscript chunk.",
        requiredShape: {
          summary: "2-4 sentence chunk summary",
          sceneFunction: "what this chunk does in the scene/chapter",
          metrics: {
            tension: "0-1",
            exposition: "0-1",
            dialogue: "0-1",
            action: "0-1",
            introspection: "0-1",
            clarity: "0-1",
            hookStrength: "0-1",
            characterMovement: "0-1"
          },
          possibleCuts: ["specific sentence/beat types to cut or compress"],
          findings: [
            {
              issueType: "clarity | pacing | exposition | dialogue | tension | character | continuity | style",
              severity: "1-5",
              confidence: "0-1",
              problem: "specific problem or strength",
              evidence: "short local evidence",
              recommendation: "concrete editorial recommendation",
              rewriteInstruction: "direct instruction for a later rewrite"
            }
          ]
        },
        manuscript: {
          title: input.manuscriptTitle,
          targetGenre: input.targetGenre,
          targetAudience: input.targetAudience
        },
        chapterTitle: input.chapterTitle,
        chunkIndex: input.chunkIndex,
        previousSummary: input.previousSummary,
        text: input.text
      },
      null,
      2
    )
  });
}

function stubChunkAnalysis(input: ChunkInput): ChunkAnalysisResult {
  const wordCount = countWords(input.text);

  return {
    summary: `Chunk ${input.chunkIndex} in ${input.chapterTitle} has ${wordCount} words. Configure OPENAI_API_KEY for full editorial analysis.`,
    sceneFunction: "local scene movement pending live model analysis",
    metrics: {
      tension: 0.4,
      exposition: 0.4,
      dialogue: /["\u201c]/.test(input.text) ? 0.6 : 0.2,
      action: 0.3,
      introspection: 0.3,
      clarity: 0.7,
      hookStrength: 0.4,
      characterMovement: 0.4
    },
    possibleCuts: [],
    findings: [
      {
        issueType: "configuration",
        severity: 1,
        confidence: 1,
        problem: "Live editor model is not configured.",
        evidence: `${wordCount} words analyzed with deterministic stub.`,
        recommendation: "Set OPENAI_API_KEY and rerun the v2 pipeline.",
        rewriteInstruction: "Preserve the source text until live analysis is available."
      }
    ]
  };
}
