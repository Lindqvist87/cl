import { jsonInput } from "@/lib/json";
import { prisma } from "@/lib/prisma";

export type ManualTrendSignalInput = {
  source: string;
  title?: string;
  author?: string;
  genre?: string;
  category?: string;
  rank?: number;
  listName?: string;
  signalDate?: Date;
  description?: string;
  blurb?: string;
  reviewSnippet?: string;
  externalUrl?: string;
  metadata?: Record<string, unknown>;
};

export async function importManualTrendSignal(input: ManualTrendSignalInput) {
  return prisma.trendSignal.create({
    data: {
      source: input.source,
      title: input.title,
      author: input.author,
      genre: input.genre,
      category: input.category,
      rank: input.rank,
      listName: input.listName,
      signalDate: input.signalDate,
      description: input.description,
      blurb: input.blurb,
      reviewSnippet: input.reviewSnippet,
      externalUrl: input.externalUrl,
      metadata: jsonInput(input.metadata ?? {})
    }
  });
}
