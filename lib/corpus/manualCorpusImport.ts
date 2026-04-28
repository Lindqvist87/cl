import mammoth from "mammoth";
import {
  CorpusAnalysisStatus,
  CorpusIngestionStatus,
  RightsStatus,
  SourceType
} from "@prisma/client";
import { calculateProfileMetrics } from "@/lib/analysis/textMetrics";
import { jsonInput } from "@/lib/json";
import { prisma } from "@/lib/prisma";
import { countWords, normalizeWhitespace } from "@/lib/text/wordCount";
import { chunkCorpusText, cleanGutenbergText } from "@/lib/corpus/textProcessing";

export type ManualCorpusImportInput = {
  file?: File;
  title: string;
  author?: string;
  language?: string;
  publicationYear?: number;
  genre?: string;
  sourceUrl?: string;
  sourceType?: SourceType;
  rightsStatus: RightsStatus;
  licenseType?: string;
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
    ? await extractCorpusUpload(input.file)
    : undefined;
  const cleanedText = extracted
    ? input.sourceType === SourceType.GUTENBERG
      ? cleanGutenbergText(extracted.text)
      : normalizeWhitespace(extracted.text)
    : "";
  const wordCount = cleanedText ? countWords(cleanedText) : 0;

  return prisma.$transaction(async (tx) => {
    const book = await tx.corpusBook.create({
      data: {
        sourceId: source.id,
        title: input.title,
        author: input.author,
        language: input.language,
        publicationYear: input.publicationYear,
        genre: input.genre,
        sourceUrl: input.sourceUrl,
        rightsStatus: input.rightsStatus,
        licenseType: input.licenseType,
        allowedUses: jsonInput(input.allowedUses ?? {}),
        fullTextAvailable: Boolean(cleanedText),
        ingestionStatus: cleanedText
          ? CorpusIngestionStatus.PROFILED
          : CorpusIngestionStatus.METADATA_ONLY,
        analysisStatus: cleanedText
          ? CorpusAnalysisStatus.COMPLETED
          : CorpusAnalysisStatus.NOT_STARTED
      }
    });

    if (!cleanedText) {
      return book;
    }

    await tx.corpusBookText.create({
      data: {
        bookId: book.id,
        rawText: extracted?.text ?? "",
        cleanedText,
        wordCount
      }
    });

    const chunks = chunkCorpusText(cleanedText);
    if (chunks.length > 0) {
      await tx.corpusChunk.createMany({
        data: chunks.map((chunk) => ({
          bookId: book.id,
          paragraphIndex: chunk.paragraphIndex,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
          metrics: jsonInput({
            wordCount: countWords(chunk.text)
          })
        }))
      });
    }

    const profile = calculateProfileMetrics([
      {
        title: input.title,
        text: cleanedText,
        wordCount
      }
    ]);

    await tx.bookProfile.create({
      data: {
        bookId: book.id,
        wordCount: profile.wordCount,
        chapterCount: profile.chapterCount,
        avgChapterWords: profile.avgChapterWords,
        avgSentenceLength: profile.avgSentenceLength,
        dialogueRatio: profile.dialogueRatio,
        expositionRatio: profile.expositionRatio,
        actionRatio: profile.actionRatio,
        introspectionRatio: profile.introspectionRatio,
        lexicalDensity: profile.lexicalDensity,
        povEstimate: profile.povEstimate,
        tenseEstimate: profile.tenseEstimate,
        openingHookType: profile.openingHookType,
        pacingCurve: jsonInput(profile.pacingCurve),
        emotionalIntensityCurve: jsonInput(profile.emotionalIntensityCurve),
        conflictDensityCurve: jsonInput(profile.conflictDensityCurve),
        chapterEndingPatterns: jsonInput(profile.chapterEndingPatterns),
        styleFingerprint: jsonInput(profile.styleFingerprint),
        genreMarkers: jsonInput(profile.genreMarkers),
        tropeMarkers: jsonInput(profile.tropeMarkers)
      }
    });

    return book;
  });
}

function sourceIdFor(sourceType: SourceType) {
  return `manual-${sourceType.toLowerCase()}`;
}

function sourceName(sourceType: SourceType) {
  return sourceType === SourceType.MANUAL
    ? "Manual Corpus"
    : `${sourceType.replace(/_/g, " ")} Import`;
}

async function extractCorpusUpload(file: File) {
  const fileName = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (fileName.endsWith(".txt") || file.type === "text/plain") {
    return {
      text: new TextDecoder("utf-8").decode(buffer)
    };
  }

  if (
    fileName.endsWith(".docx") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value };
  }

  if (fileName.endsWith(".epub")) {
    throw new Error("EPUB corpus extraction is stubbed. Convert to TXT for now.");
  }

  throw new Error("Unsupported corpus file type. Upload TXT or DOCX for full text.");
}
