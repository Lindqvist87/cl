import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import { modelConfigForRole } from "@/lib/ai/modelConfig";
import type { WholeBookAnalysisResult } from "@/lib/ai/analysisTypes";
import { stubUsageLog } from "@/lib/ai/usage";

type WholeBookInput = {
  manuscriptTitle: string;
  targetGenre?: string | null;
  targetAudience?: string | null;
  wordCount: number;
  chapterSummaries: Array<{
    id?: string;
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
    ...modelConfigForRole("chiefEditor"),
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
              problemTitle: "short specific title",
              problemType: "specific editorial category",
              severity: "1-5",
              priority: "1-5 editorial urgency",
              confidence: "0-1",
              problem: "specific issue",
              whyItMatters: "why this matters for the reader or rewrite order",
              doThisNow: "small concrete next edit",
              scope: "global",
              affectedChapters: ["chapter ids or titles if supported by summaries"],
              affectedSections: ["section labels if supported by summaries"],
              evidence: "summary/profile evidence",
              sourceTextExcerpt: "summary excerpt when raw text is not provided",
              evidenceReason: "why this summary/profile signal supports the finding",
              evidenceAnchors: [
                {
                  chapterId: "chapter id when available",
                  granularity: "chapter | manuscript",
                  sourceTextExcerpt: "summary excerpt",
                  reason: "why this supports the finding"
                }
              ],
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
        problemTitle: "Whole-book model not configured",
        problemType: "configuration",
        issueType: "configuration",
        severity: 1,
        priority: 1,
        confidence: 1,
        problem: "Live whole-book analysis is not configured.",
        whyItMatters: "Without live global analysis, this row only verifies stored context.",
        doThisNow: "Set OPENAI_API_KEY and rerun the full pipeline.",
        scope: "global",
        evidence: "Pipeline has stored chapter summaries and profile metrics.",
        sourceTextExcerpt: input.chapterSummaries[0]?.summary ?? input.chapterSummaries[0]?.title,
        evidenceReason: "The finding is supported by the presence of compact chapter/profile artifacts, not raw manuscript reading.",
        evidenceAnchors: [
          {
            chapterId: input.chapterSummaries[0]?.id ?? null,
            granularity: input.chapterSummaries[0]?.id ? "chapter" : "manuscript",
            sourceTextExcerpt:
              input.chapterSummaries[0]?.summary ?? input.chapterSummaries[0]?.title,
            reason: "The stub only has chapter summaries and profile metrics."
          }
        ],
        recommendation: "Set OPENAI_API_KEY and rerun the full pipeline.",
        rewriteInstruction: "Do not make major structural changes from stub output alone."
      }
    ],
    valueRaisingEdits: ["Run live analysis before prioritizing revision spend."]
  };
}
