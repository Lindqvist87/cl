import { NextResponse } from "next/server";
import { findCorpusProgressStatus } from "@/lib/corpus/corpusProgress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;
  const status = await findCorpusProgressStatus(bookId);

  if (!status) {
    return NextResponse.json(
      { error: "Corpus book not found." },
      { status: 404 }
    );
  }

  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
