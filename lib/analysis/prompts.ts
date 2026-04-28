import type { AnalysisPassType } from "@prisma/client";
import type { JsonRecord, ManuscriptMemory } from "@/lib/types";
import { PASS_LABELS } from "@/lib/analysis/passes";

export const PROMPT_VERSION = "audit-mvp-1";

export function buildChunkAnalysisPrompt(input: {
  passType: AnalysisPassType;
  manuscript: {
    title: string;
    wordCount: number;
    chapterCount: number;
  };
  chunk: {
    chunkIndex: number;
    chapterTitle: string;
    wordCount: number;
    text: string;
    metadata?: JsonRecord | null;
  };
  memory: ManuscriptMemory;
}) {
  return {
    system: [
      "You are a senior manuscript analyst for a production editing system.",
      "Return strict JSON only.",
      "Analyze only the supplied chunk and the supplied memory.",
      "Never rely on or quote copyrighted books as training examples.",
      "Be specific, evidence-led, and concise."
    ].join(" "),
    user: JSON.stringify(
      {
        task: PASS_LABELS[input.passType],
        requiredShape: {
          summary: "short chunk-level summary",
          findings: [
            {
              title: "issue or strength",
              severity: "critical | high | medium | low",
              evidence: "brief phrase from this chunk or description",
              recommendation: "actionable editorial advice"
            }
          ],
          chapterNotes: ["notes relevant to this chapter"],
          memoryUpdates: {
            premise: "optional",
            genre: "optional",
            characters: [{ name: "optional", role: "optional", arcNotes: "optional" }],
            plotThreads: ["optional"],
            settingNotes: ["optional"],
            styleNotes: ["optional"],
            risks: ["optional"]
          }
        },
        manuscript: input.manuscript,
        chunk: {
          chunkIndex: input.chunk.chunkIndex,
          chapterTitle: input.chunk.chapterTitle,
          wordCount: input.chunk.wordCount,
          metadata: input.chunk.metadata,
          text: input.chunk.text
        },
        currentMemory: input.memory
      },
      null,
      2
    )
  };
}

export function buildPassSynthesisPrompt(input: {
  passType: AnalysisPassType;
  manuscriptTitle: string;
  chunkSummaries: JsonRecord[];
  memory: ManuscriptMemory;
}) {
  return {
    system: [
      "You synthesize chunk-level manuscript analysis into pass-level editorial memory.",
      "Return strict JSON only.",
      "Use only the supplied summaries and memory, not the full manuscript."
    ].join(" "),
    user: JSON.stringify(
      {
        task: `Synthesize ${PASS_LABELS[input.passType]}`,
        requiredShape: {
          passSummary: "5-10 sentence synthesis",
          keyIssues: [
            {
              title: "issue",
              severity: "critical | high | medium | low",
              recommendation: "action"
            }
          ],
          memoryUpdates: {
            premise: "optional",
            genre: "optional",
            targetAudience: "optional",
            corePromise: "optional",
            characters: [{ name: "optional", role: "optional", arcNotes: "optional" }],
            plotThreads: ["optional"],
            settingNotes: ["optional"],
            styleNotes: ["optional"],
            risks: ["optional"]
          }
        },
        manuscriptTitle: input.manuscriptTitle,
        chunkSummaries: input.chunkSummaries,
        currentMemory: input.memory
      },
      null,
      2
    )
  };
}

export function buildFinalReportPrompt(input: {
  manuscript: {
    title: string;
    wordCount: number;
    chapterCount: number;
  };
  passSummaries: JsonRecord[];
  chapterTitles: string[];
  memory: ManuscriptMemory;
}) {
  return {
    system: [
      "You create manuscript audit reports for authors and editors.",
      "Return strict JSON only.",
      "Use only the supplied pass summaries and global memory."
    ].join(" "),
    user: JSON.stringify(
      {
        task: "Create final manuscript audit report",
        requiredShape: {
          executiveSummary: "plain language executive summary",
          topIssues: [
            {
              title: "issue title",
              severity: "critical | high | medium | low",
              chapter: "optional chapter title",
              evidence: "short evidence summary",
              recommendation: "recommended fix"
            }
          ],
          chapterNotes: [
            {
              chapter: "chapter title",
              notes: ["specific notes"],
              priority: "critical | high | medium | low"
            }
          ],
          rewriteStrategy: "recommended revision strategy"
        },
        manuscript: input.manuscript,
        chapterTitles: input.chapterTitles,
        passSummaries: input.passSummaries,
        globalMemory: input.memory,
        constraints: {
          topIssuesLimit: 20,
          noFullManuscriptWasProvided: true
        }
      },
      null,
      2
    )
  };
}
