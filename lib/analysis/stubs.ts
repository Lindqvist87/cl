import type { AnalysisPassType } from "@prisma/client";
import type { AuditReportJson, JsonRecord, ManuscriptMemory } from "@/lib/types";
import { PASS_LABELS } from "@/lib/analysis/passes";

export function stubChunkOutput(input: {
  passType: AnalysisPassType;
  chunkIndex: number;
  chapterTitle: string;
  wordCount: number;
}): JsonRecord {
  return {
    summary: `${PASS_LABELS[input.passType]} placeholder for chunk ${input.chunkIndex}. Configure OPENAI_API_KEY for live analysis.`,
    findings: [
      {
        title: "Live model not configured",
        severity: "low",
        evidence: `${input.chapterTitle}, ${input.wordCount} words`,
        recommendation: "Set OPENAI_API_KEY and rerun the audit to replace this stub output."
      }
    ],
    chapterNotes: [`Stub note for ${input.chapterTitle}.`],
    memoryUpdates: {
      risks: ["Audit currently uses deterministic stubs."]
    }
  };
}

export function stubPassSynthesis(input: {
  passType: AnalysisPassType;
  chunkCount: number;
}): JsonRecord {
  return {
    passSummary: `${PASS_LABELS[input.passType]} synthesized from ${input.chunkCount} chunk outputs using the local stub.`,
    keyIssues: [
      {
        title: "OpenAI analysis pending",
        severity: "low",
        recommendation: "Configure OpenAI credentials and rerun this pass."
      }
    ],
    memoryUpdates: {
      risks: ["Pass synthesis is stubbed until OpenAI is configured."]
    }
  };
}

export function stubReport(input: {
  title: string;
  chapterTitles: string[];
  memory: ManuscriptMemory;
}): AuditReportJson {
  return {
    executiveSummary: `Audit report for ${input.title}. This report was generated without OPENAI_API_KEY, so it proves storage, parsing, resumability, and export flow rather than editorial quality.`,
    topIssues: [
      {
        title: "Configure live AI analysis",
        severity: "low",
        recommendation: "Set OPENAI_API_KEY and run the audit again."
      }
    ],
    chapterNotes: input.chapterTitles.map((chapter) => ({
      chapter,
      notes: ["Awaiting live model analysis."],
      priority: "low"
    })),
    rewriteStrategy:
      "Run the live audit, triage critical and high severity findings first, then rewrite chapter one against the synthesized premise, structure, character, pacing, style, and market notes.",
    metadata: {
      stub: true,
      memoryRiskCount: input.memory.risks.length
    }
  };
}
