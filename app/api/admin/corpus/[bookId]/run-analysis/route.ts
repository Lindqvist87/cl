import { NextResponse } from "next/server";
import {
  corpusAnalysisHttpStatus,
  startCorpusAnalysis
} from "@/lib/corpus/startCorpusAnalysis";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;

  try {
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

    const result = await startCorpusAnalysis({
      corpusBookId: book.id,
      source: book.sourceId,
      runFallbackWhenDisabled: true
    });

    return NextResponse.json(result, {
      status: corpusAnalysisHttpStatus(result)
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Corpus analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
