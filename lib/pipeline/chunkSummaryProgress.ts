import { prisma } from "@/lib/prisma";

export type ChunkSummaryProgress = {
  total: number;
  summarized: number;
  remaining: number;
};

export function hasUsableChunkSummary(summary: unknown): summary is string {
  return typeof summary === "string" && summary.trim().length > 0;
}

export async function getChunkSummaryProgress(
  manuscriptId: string
): Promise<ChunkSummaryProgress> {
  const [total, summarized] = await Promise.all([
    prisma.manuscriptChunk.count({ where: { manuscriptId } }),
    prisma.manuscriptChunk.count({
      where: {
        manuscriptId,
        AND: [{ summary: { not: null } }, { summary: { not: "" } }]
      }
    })
  ]);

  return {
    total,
    summarized,
    remaining: Math.max(total - summarized, 0)
  };
}
