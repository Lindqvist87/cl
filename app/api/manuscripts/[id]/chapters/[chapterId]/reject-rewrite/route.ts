import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; chapterId: string }> }
) {
  const { id, chapterId } = await params;
  const rewrite = await prisma.chapterRewrite.findFirst({
    where: {
      manuscriptId: id,
      chapterId,
      status: { in: ["DRAFT", "ACCEPTED"] }
    },
    orderBy: { createdAt: "desc" }
  });

  if (!rewrite) {
    return NextResponse.json({ error: "Chapter rewrite not found." }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const rejected = await tx.chapterRewrite.update({
      where: { id: rewrite.id },
      data: { status: "REJECTED" }
    });

    await tx.manuscriptChapter.update({
      where: { id: chapterId },
      data: { status: "REWRITE_REJECTED" }
    });

    return rejected;
  });

  return NextResponse.json({
    rewriteId: updated.id,
    status: updated.status
  });
}
