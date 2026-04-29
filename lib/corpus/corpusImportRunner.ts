import {
  CorpusAnalysisStatus,
  CorpusIngestionStatus,
  type Prisma,
  RightsStatus
} from "@prisma/client";
import { createEmbedding, hasEditorModelKey } from "@/lib/ai/editorModel";
import { calculateProfileMetrics } from "@/lib/analysis/textMetrics";
import {
  chapterMetrics,
  chaptersForProfile,
  corpusBenchmarkReady,
  profileDataFromMetrics
} from "@/lib/corpus/bookDna";
import { jsonInput } from "@/lib/json";
import { parseManuscriptText } from "@/lib/parsing/chapterDetector";
import { chunkParsedManuscript } from "@/lib/parsing/chunker";
import { prisma } from "@/lib/prisma";
import { truncateWords } from "@/lib/text/wordCount";

const FULL_TEXT_RIGHTS = new Set<RightsStatus>([
  RightsStatus.PUBLIC_DOMAIN,
  RightsStatus.OPEN_LICENSE,
  RightsStatus.LICENSED,
  RightsStatus.PRIVATE_REFERENCE
]);

type ImportProgress = {
  uploaded: boolean;
  textExtracted: boolean;
  cleaned: boolean;
  chaptersDetected: boolean;
  chunksCreated: boolean;
  embeddingsCreated: boolean;
  bookDnaExtracted: boolean;
  benchmarkReady: boolean;
  embeddingStatus?: string;
  error?: string;
};

export async function runCorpusImportForBook(corpusBookId: string) {
  const job = await findOrCreateImportJob(corpusBookId);
  let book = await prisma.corpusBook.findUnique({
    where: { id: corpusBookId },
    include: {
      text: true,
      chunks: true,
      chapters: { orderBy: { order: "asc" } },
      profile: true
    }
  });

  if (!book) {
    throw new Error("Corpus book not found.");
  }

  const bookId = book.id;
  const progress = normalizeProgress(book.importProgress);
  await markImportStep(bookId, job.id, "uploaded", progress, "RUNNING");

  try {
    if (!FULL_TEXT_RIGHTS.has(book.rightsStatus)) {
      if (book.text) {
        throw new Error("Corpus full text cannot be processed without allowed rights.");
      }

      progress.textExtracted = false;
      progress.cleaned = false;
      progress.benchmarkReady = false;
      await prisma.corpusBook.update({
        where: { id: book.id },
        data: {
          fullTextAvailable: false,
          ingestionStatus: CorpusIngestionStatus.METADATA_ONLY,
          analysisStatus: CorpusAnalysisStatus.NOT_STARTED,
          benchmarkReady: false,
          benchmarkReadyAt: null,
          importProgress: jsonInput(progress)
        }
      });
      await completeImportJob(job.id, "metadata_only", progress);
      return prisma.corpusBook.findUniqueOrThrow({ where: { id: book.id } });
    }

    if (!book.text?.cleanedText) {
      progress.textExtracted = false;
      progress.cleaned = false;
      progress.benchmarkReady = false;
      await prisma.corpusBook.update({
        where: { id: book.id },
        data: {
          fullTextAvailable: false,
          ingestionStatus: CorpusIngestionStatus.METADATA_ONLY,
          analysisStatus: CorpusAnalysisStatus.NOT_STARTED,
          benchmarkReady: false,
          benchmarkReadyAt: null,
          importProgress: jsonInput(progress)
        }
      });
      await completeImportJob(job.id, "metadata_only", progress);
      return prisma.corpusBook.findUniqueOrThrow({ where: { id: book.id } });
    }

    progress.textExtracted = true;
    progress.cleaned = true;
    await markImportStep(bookId, job.id, "cleaned", progress, "RUNNING");

    const parsed = parseManuscriptText(
      book.text.cleanedText,
      book.fileName ?? `${book.title}.txt`
    );
    const profileChapters = chaptersForProfile(parsed);

    if (book.chapters.length === 0) {
      for (const chapter of parsed.chapters) {
        const chapterText =
          profileChapters[chapter.order - 1]?.text ??
          chapter.scenes
            .flatMap((scene) => scene.paragraphs.map((paragraph) => paragraph.text))
            .join("\n\n");

        await prisma.corpusChapter.create({
          data: {
            bookId: book.id,
            order: chapter.order,
            chapterIndex: chapter.order,
            title: chapter.title,
            heading: chapter.heading,
            text: chapterText,
            wordCount: chapter.wordCount,
            startOffset: chapter.startOffset,
            endOffset: chapter.endOffset,
            metrics: jsonInput(chapterMetrics(chapterText))
          }
        });
      }
    }

    progress.chaptersDetected = true;
    await markImportStep(bookId, job.id, "chapters_detected", progress, "RUNNING", {
      ingestionStatus: CorpusIngestionStatus.IMPORTED,
      analysisStatus: CorpusAnalysisStatus.RUNNING
    });

    const chapters = await prisma.corpusChapter.findMany({
      where: { bookId: book.id },
      orderBy: { order: "asc" }
    });
    const chapterIdByOrder = new Map(
      chapters.map((chapter) => [chapter.order, chapter.id])
    );

    if (book.chunks.length === 0) {
      const chunks = chunkParsedManuscript(parsed);
      if (chunks.length > 0) {
        await prisma.corpusChunk.createMany({
          data: chunks.map((chunk) => ({
            bookId,
            corpusChapterId: chapterIdByOrder.get(chunk.chapterOrder),
            chapterIndex: chunk.chapterOrder,
            sectionIndex: chunk.sceneOrder,
            paragraphIndex: chunk.startParagraph,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            tokenCount: chunk.tokenEstimate,
            embeddingStatus: "PENDING",
            summary: truncateWords(chunk.text, 80),
            metrics: jsonInput({
              wordCount: chunk.wordCount,
              chapterTitle: chunk.metadata.chapterTitle,
              sceneTitle: chunk.metadata.sceneTitle,
              paragraphCount: chunk.metadata.paragraphCount
            })
          })),
          skipDuplicates: true
        });
      }
    }

    progress.chunksCreated = true;
    await markImportStep(bookId, job.id, "chunks_created", progress, "RUNNING", {
      ingestionStatus: CorpusIngestionStatus.CHUNKED
    });

    const embeddingStatus = await createEmbeddingsForCorpusChunks(book.id);
    progress.embeddingsCreated = true;
    progress.embeddingStatus = embeddingStatus;
    await markImportStep(bookId, job.id, "embeddings_created", progress, "RUNNING");

    if (!book.profile) {
      const profile = calculateProfileMetrics(profileChapters);
      await prisma.bookProfile.create({
        data: {
          bookId: book.id,
          ...profileDataFromMetrics(profile)
        }
      });
    }

    progress.bookDnaExtracted = true;
    await markImportStep(bookId, job.id, "book_dna_extracted", progress, "RUNNING", {
      ingestionStatus: CorpusIngestionStatus.PROFILED,
      analysisStatus: CorpusAnalysisStatus.COMPLETED
    });

    const chunkCount = await prisma.corpusChunk.count({ where: { bookId: book.id } });
    book = await prisma.corpusBook.findUniqueOrThrow({
      where: { id: book.id },
      include: {
        text: true,
        chunks: true,
        chapters: true,
        profile: true
      }
    });
    const benchmarkReady = corpusBenchmarkReady({
      rightsStatus: book.rightsStatus,
      allowedUses: book.allowedUses,
      benchmarkAllowed: book.benchmarkAllowed,
      profileExists: Boolean(book.profile),
      chunkCount
    });
    progress.benchmarkReady = benchmarkReady;

    const updated = await prisma.corpusBook.update({
      where: { id: book.id },
      data: {
        fullTextAvailable: true,
        ingestionStatus: CorpusIngestionStatus.PROFILED,
        analysisStatus: CorpusAnalysisStatus.COMPLETED,
        benchmarkReady,
        benchmarkReadyAt: benchmarkReady ? new Date() : null,
        importProgress: jsonInput(progress)
      }
    });
    await completeImportJob(job.id, "benchmark_ready", progress);

    return updated;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Corpus import failed.";
    progress.error = message;
    await prisma.corpusBook.update({
      where: { id: corpusBookId },
      data: {
        ingestionStatus: CorpusIngestionStatus.FAILED,
        analysisStatus: CorpusAnalysisStatus.FAILED,
        importProgress: jsonInput(progress)
      }
    });
    await prisma.corpusImportJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error: message,
        progress: jsonInput(progress),
        completedAt: new Date()
      }
    });
    throw error;
  }
}

async function findOrCreateImportJob(bookId: string) {
  const existing = await prisma.corpusImportJob.findFirst({
    where: {
      bookId,
      status: { in: ["QUEUED", "RUNNING", "FAILED"] }
    },
    orderBy: { createdAt: "desc" }
  });

  if (existing) {
    return existing;
  }

  return prisma.corpusImportJob.create({
    data: {
      bookId,
      status: "QUEUED",
      currentStep: "uploaded",
      progress: jsonInput(normalizeProgress(undefined))
    }
  });
}

async function markImportStep(
  bookId: string,
  jobId: string,
  currentStep: string,
  progress: ImportProgress,
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED",
  bookData: Prisma.CorpusBookUpdateInput = {}
) {
  await prisma.$transaction([
    prisma.corpusBook.update({
      where: { id: bookId },
      data: {
        ...bookData,
        importProgress: jsonInput(progress)
      }
    }),
    prisma.corpusImportJob.update({
      where: { id: jobId },
      data: {
        status,
        currentStep,
        progress: jsonInput(progress),
        startedAt: status === "RUNNING" ? new Date() : undefined
      }
    })
  ]);
}

async function completeImportJob(
  jobId: string,
  currentStep: string,
  progress: ImportProgress
) {
  await prisma.corpusImportJob.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      currentStep,
      progress: jsonInput(progress),
      completedAt: new Date()
    }
  });
}

async function createEmbeddingsForCorpusChunks(bookId: string) {
  const chunks = await prisma.corpusChunk.findMany({
    where: {
      bookId,
      embeddingStatus: { in: ["PENDING", "FAILED"] }
    },
    orderBy: { chunkIndex: "asc" }
  });

  if (chunks.length === 0) {
    return "complete";
  }

  if (!hasEditorModelKey()) {
    await prisma.corpusChunk.updateMany({
      where: {
        bookId,
        embeddingStatus: { in: ["PENDING", "FAILED"] }
      },
      data: {
        embeddingStatus: "SKIPPED"
      }
    });
    return "skipped: OPENAI_API_KEY not configured";
  }

  let stored = 0;
  for (const chunk of chunks) {
    try {
      const embedding = await createEmbedding(chunk.text);
      if (embedding.length > 0) {
        await storeCorpusChunkEmbedding(chunk.id, embedding);
        await prisma.corpusChunk.update({
          where: { id: chunk.id },
          data: { embeddingStatus: "STORED" }
        });
        stored += 1;
      } else {
        await prisma.corpusChunk.update({
          where: { id: chunk.id },
          data: { embeddingStatus: "EMPTY" }
        });
      }
    } catch {
      await prisma.corpusChunk.update({
        where: { id: chunk.id },
        data: { embeddingStatus: "FAILED" }
      });
    }
  }

  return `stored ${stored}/${chunks.length}`;
}

async function storeCorpusChunkEmbedding(chunkId: string, embedding: number[]) {
  const vectorLiteral = `[${embedding.join(",")}]`;
  await prisma.$executeRawUnsafe(
    'UPDATE "CorpusChunk" SET "embedding" = $1::vector WHERE "id" = $2',
    vectorLiteral,
    chunkId
  );
}

function normalizeProgress(value: unknown): ImportProgress {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Partial<ImportProgress>)
    : {};

  return {
    uploaded: record.uploaded ?? true,
    textExtracted: record.textExtracted ?? false,
    cleaned: record.cleaned ?? false,
    chaptersDetected: record.chaptersDetected ?? false,
    chunksCreated: record.chunksCreated ?? false,
    embeddingsCreated: record.embeddingsCreated ?? false,
    bookDnaExtracted: record.bookDnaExtracted ?? false,
    benchmarkReady: record.benchmarkReady ?? false,
    embeddingStatus: record.embeddingStatus,
    error: record.error
  };
}
