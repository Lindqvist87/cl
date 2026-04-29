import { prisma } from "@/lib/prisma";

export async function runTrendImport(input: {
  importId?: string | null;
  source: string;
}) {
  if (!input.importId) {
    return {
      source: input.source,
      metadataOnly: true,
      imported: false
    };
  }

  const signal = await prisma.trendSignal.findUnique({
    where: { id: input.importId }
  });

  if (!signal) {
    throw new Error("Trend import row not found.");
  }

  return {
    source: signal.source,
    signalId: signal.id,
    metadataOnly: true,
    imported: true
  };
}
