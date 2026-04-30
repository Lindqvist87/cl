import { findCorpusPipelineJobs } from "@/lib/corpus/corpusAnalysisJobs";
import {
  buildCorpusProgressStatus,
  type CorpusProgressStatus
} from "@/lib/corpus/corpusProgressShared";
import { prisma } from "@/lib/prisma";

export async function getCorpusProgressStatus(
  bookId: string
): Promise<CorpusProgressStatus> {
  const status = await findCorpusProgressStatus(bookId);
  if (!status) {
    throw new Error("Corpus book not found.");
  }

  return status;
}

export async function findCorpusProgressStatus(bookId: string) {
  const book = await prisma.corpusBook.findUnique({
    where: { id: bookId },
    select: {
      id: true,
      fullTextAvailable: true,
      ingestionStatus: true,
      analysisStatus: true,
      benchmarkReady: true,
      benchmarkReadyAt: true,
      benchmarkBlockedReason: true,
      importProgress: true,
      updatedAt: true,
      text: {
        select: {
          cleanedAt: true
        }
      },
      profile: {
        select: {
          id: true,
          createdAt: true
        }
      },
      importJobs: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          currentStep: true,
          error: true,
          updatedAt: true
        }
      },
      _count: {
        select: {
          chapters: true,
          chunks: true
        }
      }
    }
  });

  if (!book) {
    return null;
  }

  const [jobs, embeddedChunks, embeddingStatusGroups] = await Promise.all([
    findCorpusPipelineJobs(bookId),
    prisma.corpusChunk.count({
      where: {
        bookId,
        embeddingStatus: "STORED"
      }
    }),
    prisma.corpusChunk.groupBy({
      by: ["embeddingStatus"],
      where: { bookId },
      _count: { _all: true }
    })
  ]);
  const latestImportJob = book.importJobs[0];

  return buildCorpusProgressStatus({
    book: {
      id: book.id,
      fullTextAvailable: book.fullTextAvailable,
      ingestionStatus: book.ingestionStatus,
      analysisStatus: book.analysisStatus,
      benchmarkReady: book.benchmarkReady,
      benchmarkReadyAt: book.benchmarkReadyAt,
      benchmarkBlockedReason: book.benchmarkBlockedReason,
      updatedAt: book.updatedAt,
      importProgress: book.importProgress,
      textCleanedAt: book.text?.cleanedAt ?? null,
      latestImportStep: latestImportJob?.currentStep ?? null,
      latestImportUpdatedAt: latestImportJob?.updatedAt ?? null,
      latestImportError: latestImportJob?.error ?? null,
      profileCreatedAt: book.profile?.createdAt ?? null,
      profileExists: Boolean(book.profile)
    },
    counts: {
      chapters: book._count.chapters,
      chunks: book._count.chunks,
      embeddedChunks
    },
    embeddingStatusCounts: embeddingStatusGroups.map((group) => ({
      status: group.embeddingStatus,
      count: group._count._all
    })),
    jobs: jobs.map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.error,
      dependencyIds: job.dependencyIds,
      metadata: job.metadata,
      readyAt: job.readyAt,
      lockedAt: job.lockedAt,
      lockExpiresAt: job.lockExpiresAt,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts
    }))
  });
}
