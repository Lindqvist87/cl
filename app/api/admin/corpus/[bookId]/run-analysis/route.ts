import { NextResponse } from "next/server";
import {
  queueCorpusBenchmarkReadinessCheck,
  releaseStaleCorpusJobLocks,
  retryFailedCorpusPipelineJobs
} from "@/lib/corpus/corpusAnalysisJobs";
import { getCorpusProgressStatus } from "@/lib/corpus/corpusProgress";
import {
  corpusAnalysisHttpStatus,
  startCorpusAnalysis
} from "@/lib/corpus/startCorpusAnalysis";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
    };
    const book = await prisma.corpusBook.findUnique({
      where: { id: bookId },
      select: { id: true, sourceId: true }
    });

    if (!book) {
      return NextResponse.json(
        { error: "Corpus book not found." },
        { status: 404 }
      );
    }

    const action = corpusRunAction(body.action);
    const maintenance =
      action === "retry_failed"
        ? await retryFailedCorpusPipelineJobs(book.id)
        : action === "resume"
          ? await releaseStaleCorpusJobLocks(book.id)
          : action === "check_benchmark"
            ? await queueCorpusBenchmarkReadinessCheck(book.id)
          : null;
    const result = await startCorpusAnalysis({
      corpusBookId: book.id,
      source: book.sourceId,
      runFallbackWhenDisabled: true,
      runManualFallbackAfterDispatch: action === "resume" || action === "start"
    });

    return NextResponse.json({
      ...result,
      action,
      maintenance,
      status: await getCorpusProgressStatus(book.id)
    }, {
      status: corpusAnalysisHttpStatus(result)
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Corpus analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function corpusRunAction(action: string | undefined) {
  return action === "retry_failed" ||
    action === "resume" ||
    action === "check_benchmark"
    ? action
    : "start";
}
