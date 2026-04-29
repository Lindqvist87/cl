import { NextResponse } from "next/server";
import { importManualCorpusBook } from "@/lib/corpus/manualCorpusImport";
import { parseCorpusOnboardingFormData } from "@/lib/corpus/onboarding";
import { startCorpusAnalysis } from "@/lib/corpus/startCorpusAnalysis";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const inputs = parseCorpusOnboardingFormData(formData);

    if (inputs.length === 0) {
      return NextResponse.json({ error: "Upload at least one book." }, { status: 400 });
    }

    if (inputs.length > 10) {
      return NextResponse.json(
        { error: "Upload at most 10 books per onboarding batch." },
        { status: 400 }
      );
    }

    const results = [];

    for (const input of inputs) {
      const book = await importManualCorpusBook({
        ...input,
        allowedUses: {
          corpusBenchmarking: input.benchmarkAllowed,
          privateReference: input.rightsStatus === "PRIVATE_REFERENCE",
          rewriteTraining: false
        }
      });
      const analysis = await startCorpusAnalysis({
        corpusBookId: book.id,
        source: book.sourceId,
        runFallbackWhenDisabled: false
      });

      results.push({
        bookId: book.id,
        title: book.title,
        eventSent: analysis.eventSent,
        executionMode: analysis.executionMode
      });
    }

    return NextResponse.json({
      imported: results.length,
      books: results
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Corpus import failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
