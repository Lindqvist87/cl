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
      chapterId
    },
    orderBy: { createdAt: "desc" }
  });

  if (!rewrite) {
    return NextResponse.json({ error: "Chapter rewrite not found." }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.chapterRewrite.updateMany({
      where: {
        manuscriptId: id,
        chapterId,
        id: { not: rewrite.id },
        status: "ACCEPTED"
      },
      data: { status: "REJECTED" }
    });

    const accepted = await tx.chapterRewrite.update({
      where: { id: rewrite.id },
      data: { status: "ACCEPTED" }
    });

    await tx.manuscriptChapter.update({
      where: { id: chapterId },
      data: { status: "REWRITE_ACCEPTED" }
    });

    return accepted;
  });

  return NextResponse.json({
    rewriteId: updated.id,
    status: updated.status
  });
}
