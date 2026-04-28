import { RightsStatus, SourceType } from "@prisma/client";
import { importManualCorpusBook } from "@/lib/corpus/manualCorpusImport";

export class LitteraturbankenSprakbankenAdapter {
  async importLocalFile(input: {
    file: File;
    title: string;
    author?: string;
    language?: string;
    publicationYear?: number;
    genre?: string;
    sourceUrl?: string;
    licenseType?: string;
    sourceType?: SourceType;
  }) {
    return importManualCorpusBook({
      ...input,
      sourceType: input.sourceType ?? SourceType.LITTERATURBANKEN,
      rightsStatus: RightsStatus.OPEN_LICENSE,
      allowedUses: {
        corpusBenchmarking: true,
        fullTextStorage: true,
        preservesSwedishMetadata: true,
        rewriteTraining: false
      }
    });
  }
}
