import {
  CorpusAnalysisStatus,
  CorpusIngestionStatus,
  RightsStatus
} from "@prisma/client";
import { calculateProfileMetrics } from "@/lib/analysis/textMetrics";
import { chunkCorpusText } from "@/lib/corpus/textProcessing";
import { jsonInput } from "@/lib/json";
import { prisma } from "@/lib/prisma";
import { countWords } from "@/lib/text/wordCount";

const FULL_TEXT_RIGHTS = new Set<RightsStatus>([
  RightsStatus.PUBLIC_DOMAIN,
  RightsStatus.OPEN_LICENSE,
  RightsStatus.LICENSED,
  RightsStatus.PRIVATE_REFERENCE
]);

export async function runCorpusImportForBook(corpusBookId: string) {
  const book = await prisma.corpusBook.findUnique({
    where: { id: corpusBookId },
    include: {
      text: true,
      chunks: { take: 1 },
      profile: true
    }
  });

  if (!book) {
    throw new Error("Corpus book not found.");
  }

  if (!FULL_TEXT_RIGHTS.has(book.rightsStatus)) {
    if (book.text) {
      await prisma.corpusBook.update({
        where: { id: book.id },
        data: {
          ingestionStatus: CorpusIngestionStatus.FAILED,
          analysisStatus: CorpusAnalysisStatus.FAILED
        }
      });
      throw new Error("Corpus full text cannot be processed without allowed rights.");
    }

    return prisma.corpusBook.update({
      where: { id: book.id },
      data: {
        fullTextAvailable: false,
        ingestionStatus: CorpusIngestionStatus.METADATA_ONLY,
        analysisStatus: CorpusAnalysisStatus.NOT_STARTED
      }
    });
  }

  if (!book.text?.cleanedText) {
    return prisma.corpusBook.update({
      where: { id: book.id },
      data: {
        fullTextAvailable: false,
        ingestionStatus: CorpusIngestionStatus.METADATA_ONLY,
        analysisStatus: CorpusAnalysisStatus.NOT_STARTED
      }
    });
  }

  if (book.chunks.length === 0) {
    const chunks = chunkCorpusText(book.text.cleanedText);
    if (chunks.length > 0) {
      await prisma.corpusChunk.createMany({
        data: chunks.map((chunk) => ({
          bookId: book.id,
          paragraphIndex: chunk.paragraphIndex,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
          metrics: jsonInput({ wordCount: countWords(chunk.text) })
        })),
        skipDuplicates: true
      });
    }
  }

  if (!book.profile) {
    const wordCount = book.text.wordCount || countWords(book.text.cleanedText);
    const profile = calculateProfileMetrics([
      {
        title: book.title,
        text: book.text.cleanedText,
        wordCount
      }
    ]);

    await prisma.bookProfile.create({
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
  }

  return prisma.corpusBook.update({
    where: { id: book.id },
    data: {
      fullTextAvailable: true,
      ingestionStatus: CorpusIngestionStatus.PROFILED,
      analysisStatus: CorpusAnalysisStatus.COMPLETED
    }
  });
}
