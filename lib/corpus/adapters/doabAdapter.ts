import { CorpusIngestionStatus, RightsStatus, SourceType } from "@prisma/client";
import { jsonInput } from "@/lib/json";
import { prisma } from "@/lib/prisma";

export class DoabAdapter {
  async importMetadata(input: {
    title: string;
    author?: string;
    language?: string;
    publicationYear?: number;
    genre?: string;
    sourceUrl?: string;
    licenseType?: string;
    fullTextAllowed?: boolean;
    metadata?: Record<string, unknown>;
  }) {
    const source = await prisma.source.upsert({
      where: { id: "doab" },
      update: {
        name: "Directory of Open Access Books",
        type: SourceType.DOAB,
        baseUrl: "https://www.doabooks.org"
      },
      create: {
        id: "doab",
        name: "Directory of Open Access Books",
        type: SourceType.DOAB,
        baseUrl: "https://www.doabooks.org"
      }
    });

    return prisma.corpusBook.create({
      data: {
        sourceId: source.id,
        title: input.title,
        author: input.author,
        language: input.language,
        publicationYear: input.publicationYear,
        genre: input.genre,
        sourceUrl: input.sourceUrl,
        rightsStatus: input.fullTextAllowed
          ? RightsStatus.OPEN_LICENSE
          : RightsStatus.METADATA_ONLY,
        licenseType: input.licenseType,
        allowedUses: jsonInput({
          metadata: input.metadata ?? {},
          corpusBenchmarking: true,
          fullTextStorage: Boolean(input.fullTextAllowed)
        }),
        fullTextAvailable: false,
        ingestionStatus: CorpusIngestionStatus.METADATA_ONLY
      }
    });
  }
}
