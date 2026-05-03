import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import { modelConfigForRole } from "@/lib/ai/modelConfig";
import type { ChunkAnalysisResult } from "@/lib/ai/analysisTypes";
import { stubUsageLog } from "@/lib/ai/usage";
import { countWords } from "@/lib/text/wordCount";

type ChunkInput = {
  manuscriptTitle: string;
  targetGenre?: string | null;
  targetAudience?: string | null;
  chapterId?: string | null;
  chunkId?: string | null;
  sceneId?: string | null;
  paragraphStart?: number | null;
  paragraphEnd?: number | null;
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
    ...modelConfigForRole("localEditor"),
    system: [
      "You are the Close Reader / Local Editor in a manuscript model orchestra.",
      "Return strict JSON only.",
      "Use only the supplied manuscript chunk and context.",
      "Make local observations only; do not make final whole-book prioritization decisions.",
      "Do not compare the prose to living authors or copyrighted modern books.",
      "Be concrete, evidence-led, and preserve the author's voice.",
      "Every meaningful finding must include a source excerpt and evidenceAnchors when possible."
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
              problemTitle: "short specific title",
              problemType: "specific editorial category",
              severity: "1-5",
              priority: "1-5 editorial urgency",
              confidence: "0-1",
              problem: "specific problem or strength",
              whyItMatters: "why this affects the reader or revision",
              doThisNow: "small concrete next edit",
              scope: "local",
              evidence: "short local evidence summary",
              sourceTextExcerpt: "exact short excerpt from this chunk",
              evidenceReason: "why this excerpt supports the finding",
              evidenceAnchors: [
                {
                  granularity: "chunk | paragraph",
                  sourceTextExcerpt: "exact short excerpt",
                  reason: "why this excerpt supports the finding"
                }
              ],
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
        sourceAnchor: {
          chapterId: input.chapterId,
          chunkId: input.chunkId,
          sceneId: input.sceneId,
          paragraphStart: input.paragraphStart,
          paragraphEnd: input.paragraphEnd
        },
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
        problemTitle: "Editor model not configured",
        problemType: "configuration",
        issueType: "configuration",
        severity: 1,
        priority: 1,
        confidence: 1,
        problem: "Live editor model is not configured.",
        whyItMatters: "Without the live close reader, this row only verifies storage.",
        doThisNow: "Set OPENAI_API_KEY and rerun the v2 pipeline.",
        scope: "local",
        evidence: `${wordCount} words analyzed with deterministic stub.`,
        sourceTextExcerpt: input.text.slice(0, 220),
        evidenceReason: "The excerpt identifies the local text span covered by this stub finding.",
        evidenceAnchors: [
          {
            manuscriptId: null,
            chapterId: input.chapterId ?? null,
            sceneId: input.sceneId ?? null,
            paragraphStart: input.paragraphStart ?? null,
            paragraphEnd: input.paragraphEnd ?? null,
            chunkId: input.chunkId ?? null,
            granularity: "chunk",
            sourceTextExcerpt: input.text.slice(0, 220),
            reason: "The stub can only anchor to the analyzed chunk."
          }
        ],
        recommendation: "Set OPENAI_API_KEY and rerun the v2 pipeline.",
        rewriteInstruction: "Preserve the source text until live analysis is available."
      }
    ]
  };
}
