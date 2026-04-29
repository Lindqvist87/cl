import {
  CorpusAnalysisStatus,
  CorpusIngestionStatus,
  RightsStatus,
  SourceType
} from "@prisma/client";
import { extractTextFromCorpusUpload } from "@/lib/corpus/extractText";
import { jsonInput } from "@/lib/json";
import { prisma } from "@/lib/prisma";
import { countWords, normalizeWhitespace } from "@/lib/text/wordCount";
import { cleanGutenbergText } from "@/lib/corpus/textProcessing";
import { validateBenchmarkRights } from "@/lib/corpus/onboarding";

export type ManualCorpusImportInput = {
  file?: File;
  title: string;
  author?: string;
  language?: string;
  publicationYear?: number;
  genre?: string;
  source?: string;
  sourceUrl?: string;
  sourceType?: SourceType;
  rightsStatus: RightsStatus;
  licenseType?: string;
  benchmarkAllowed?: boolean;
  allowedUses?: Record<string, unknown>;
};

const FULL_TEXT_RIGHTS = new Set<RightsStatus>([
  RightsStatus.PUBLIC_DOMAIN,
  RightsStatus.OPEN_LICENSE,
  RightsStatus.LICENSED,
  RightsStatus.PRIVATE_REFERENCE
]);

export async function importManualCorpusBook(input: ManualCorpusImportInput) {
  const sourceType = input.sourceType ?? SourceType.MANUAL;
  const benchmarkAllowed =
    input.benchmarkAllowed ??
    input.allowedUses?.corpusBenchmarking === true;
  validateBenchmarkRights({
    benchmarkAllowed,
    rightsStatus: input.rightsStatus
  });

  const sourceId = sourceIdFor(sourceType);
  const source = await prisma.source.upsert({
    where: { id: sourceId },
    update: {
      name: sourceName(sourceType),
      type: sourceType,
      rightsNotes: "Manual imports require an explicit rights status before full text is stored."
    },
    create: {
      id: sourceId,
      name: sourceName(sourceType),
      type: sourceType,
      rightsNotes: "Manual imports require an explicit rights status before full text is stored."
    }
  });

  const canStoreFullText = FULL_TEXT_RIGHTS.has(input.rightsStatus);
  const extracted = input.file && canStoreFullText
    ? await extractTextFromCorpusUpload(input.file)
    : undefined;
  const extractedCleanText = extracted?.cleanedText ?? extracted?.text;
  const cleanedText = extracted
    ? input.sourceType === SourceType.GUTENBERG
      ? cleanGutenbergText(extractedCleanText ?? "")
      : normalizeWhitespace(extractedCleanText ?? "")
    : "";
  const wordCount = cleanedText ? countWords(cleanedText) : 0;
  const extractionReport = extracted
    ? buildExtractionReport(extracted, input, cleanedText)
    : undefined;

  return prisma.$transaction(async (tx) => {
    const book = await tx.corpusBook.create({
      data: {
        sourceId: source.id,
        title: input.title,
        author: input.author,
        language: input.language,
        publicationYear: input.publicationYear,
        genre: input.genre,
        sourceName: input.source,
        sourceUrl: input.sourceUrl,
        fileName: input.file?.name,
        fileMimeType: extracted?.mimeType ?? input.file?.type,
        fileFormat: extracted?.format,
        rightsStatus: input.rightsStatus,
        licenseType: input.licenseType,
        benchmarkAllowed,
        allowedUses: jsonInput({
          ...(input.allowedUses ?? {}),
          corpusBenchmarking: benchmarkAllowed,
          fullTextStorage: canStoreFullText
        }),
        fullTextAvailable: Boolean(cleanedText),
        ingestionStatus: cleanedText
          ? CorpusIngestionStatus.IMPORTED
          : CorpusIngestionStatus.METADATA_ONLY,
        analysisStatus: cleanedText
          ? CorpusAnalysisStatus.NOT_STARTED
          : CorpusAnalysisStatus.NOT_STARTED,
        importProgress: jsonInput(initialImportProgress(Boolean(cleanedText)))
      }
    });

    if (cleanedText) {
      await tx.corpusBookText.create({
        data: {
          bookId: book.id,
          rawText: extracted?.rawText ?? extracted?.text ?? "",
          cleanedText,
          extractionReport: extractionReport ? jsonInput(extractionReport) : undefined,
          wordCount,
          cleanedAt: new Date()
        }
      });
    }

    await tx.corpusImportJob.create({
      data: {
        bookId: book.id,
        status: "QUEUED",
        currentStep: cleanedText ? "uploaded" : "metadata_only",
        progress: jsonInput(initialImportProgress(Boolean(cleanedText)))
      }
    });

    return book;
  });
}

function buildExtractionReport(
  extracted: Awaited<ReturnType<typeof extractTextFromCorpusUpload>>,
  input: ManualCorpusImportInput,
  cleanedText: string
) {
  return {
    ...(extracted.extractionReport ?? {
      format: extracted.format,
      sourceFormat: extracted.format,
      warnings: extracted.extractionWarnings ?? []
    }),
    userMetadataPreserved: true,
    canonicalMetadata: {
      title: input.title,
      author: input.author,
      language: input.language,
      publicationYear: input.publicationYear,
      genre: input.genre,
      source: input.source,
      sourceUrl: input.sourceUrl,
      rightsStatus: input.rightsStatus
    },
    detectedMetadata: {
      title: extracted.detectedTitle,
      author: extracted.detectedAuthor,
      language: extracted.detectedLanguage,
      publisher: extracted.detectedPublisher,
      publicationDate: extracted.detectedPublicationDate,
      identifier: extracted.detectedIdentifier
    },
    cleanedWordCount: countWords(cleanedText)
  };
}

function sourceIdFor(sourceType: SourceType) {
  return `manual-${sourceType.toLowerCase()}`;
}

function sourceName(sourceType: SourceType) {
  return sourceType === SourceType.MANUAL
    ? "Manual Corpus"
    : `${sourceType.replace(/_/g, " ")} Import`;
}

function initialImportProgress(hasText: boolean) {
  return {
    uploaded: true,
    textExtracted: hasText,
    cleaned: hasText,
    chaptersDetected: false,
    chunksCreated: false,
    embeddingsCreated: false,
    bookDnaExtracted: false,
    benchmarkReady: false
  };
}
