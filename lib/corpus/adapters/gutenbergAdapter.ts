import { RightsStatus, SourceType } from "@prisma/client";
import { importManualCorpusBook } from "@/lib/corpus/manualCorpusImport";

export class GutenbergAdapter {
  async importLocalFile(input: {
    file: File;
    title: string;
    author?: string;
    language?: string;
    publicationYear?: number;
    genre?: string;
    sourceUrl?: string;
  }) {
    return importManualCorpusBook({
      ...input,
      sourceType: SourceType.GUTENBERG,
      rightsStatus: RightsStatus.PUBLIC_DOMAIN,
      allowedUses: {
        corpusBenchmarking: true,
        fullTextStorage: true,
        rewriteTraining: false
      }
    });
  }
}
