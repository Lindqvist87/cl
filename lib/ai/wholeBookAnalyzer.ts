import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import type { WholeBookAnalysisResult } from "@/lib/ai/analysisTypes";
import { stubUsageLog } from "@/lib/ai/usage";

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

  return requestEditorJson<WholeBookAnalysisResult>({
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
          title: input.manuscriptTitle,
          targetGenre: input.targetGenre,
          targetAudience: input.targetAudience,
          wordCount: input.wordCount
        },
        chapterSummaries: input.chapterSummaries,
        profile: input.profile,
        limits: {
          topIssues: 20,
          valueRaisingEdits: 10
        }
      },
      null,
      2
    )
  });
}

function stubWholeBookAnalysis(input: WholeBookInput): WholeBookAnalysisResult {
  return {
    executiveSummary: `${input.manuscriptTitle} has ${input.wordCount.toLocaleString()} words across ${input.chapterSummaries.length} chapters. This whole-book audit is a deterministic stub until OPENAI_API_KEY is configured.`,
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
        evidence: "Pipeline has stored chapter summaries and profile metrics.",
        recommendation: "Set OPENAI_API_KEY and rerun the full pipeline.",
        rewriteInstruction: "Do not make major structural changes from stub output alone."
      }
    ],
    valueRaisingEdits: ["Run live analysis before prioritizing revision spend."]
  };
}
