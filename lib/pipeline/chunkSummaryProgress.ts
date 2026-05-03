import { AnalysisPassType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ChunkSummaryProgress = {
  total: number;
  summarized: number;
  outputCount: number;
  summaryRowCount: number;
  remaining: number;
};

export function hasUsableChunkSummary(summary: unknown): summary is string {
  return typeof summary === "string" && summary.trim().length > 0;
}

export async function getChunkSummaryProgress(
  manuscriptId: string,
  runId?: string | null
): Promise<ChunkSummaryProgress> {
  const outputWhere = {
    manuscriptId,
    passType: AnalysisPassType.CHUNK_ANALYSIS,
    scopeType: "chunk",
    ...(runId ? { runId } : {})
  };
  const [total, outputCount, summaryRowCount] = await Promise.all([
    prisma.manuscriptChunk.count({ where: { manuscriptId } }),
    prisma.analysisOutput.count({ where: outputWhere }),
    prisma.manuscriptChunk.count({
      where: {
        manuscriptId,
        AND: [{ summary: { not: null } }, { summary: { not: "" } }]
      }
    })
  ]);
  const summarized = Math.min(total, runId || outputCount > 0 ? outputCount : summaryRowCount);

  return {
    total,
    summarized,
    outputCount,
    summaryRowCount,
    remaining: Math.max(total - summarized, 0)
  };
}
