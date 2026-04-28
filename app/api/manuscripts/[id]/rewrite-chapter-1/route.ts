import { NextResponse } from "next/server";
import { rewriteChapterOne } from "@/lib/rewrite/chapterRewrite";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const rewrite = await rewriteChapterOne(id);
    return NextResponse.json({
      rewriteId: rewrite.id,
      manuscriptId: rewrite.manuscriptId
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Chapter rewrite failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
