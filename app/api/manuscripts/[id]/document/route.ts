import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ManuscriptDocumentNotFoundError,
  ManuscriptDocumentValidationError,
  saveEditableManuscriptDocument
} from "@/lib/server/manuscriptDocument";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const manuscript = await prisma.manuscript.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      sourceFileName: true,
      originalText: true,
      wordCount: true,
      updatedAt: true
    }
  });

  if (!manuscript) {
    return NextResponse.json({ error: "Manuscript not found." }, { status: 404 });
  }

  return NextResponse.json({
    manuscriptId: manuscript.id,
    title: manuscript.title,
    sourceFileName: manuscript.sourceFileName,
    text: manuscript.originalText ?? "",
    wordCount: manuscript.wordCount,
    updatedAt: manuscript.updatedAt.toISOString()
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  if (!isRecord(body) || typeof body.text !== "string") {
    return NextResponse.json(
      { error: "Document text is required." },
      { status: 400 }
    );
  }

  try {
    const manuscript = await saveEditableManuscriptDocument({
      manuscriptId: id,
      text: body.text
    });

    return NextResponse.json({
      manuscriptId: manuscript.id,
      title: manuscript.title,
      text: manuscript.originalText ?? "",
      wordCount: manuscript.wordCount,
      updatedAt: manuscript.updatedAt.toISOString()
    });
  } catch (error) {
    if (error instanceof ManuscriptDocumentNotFoundError) {
      return NextResponse.json(
        { error: "Manuscript not found." },
        { status: 404 }
      );
    }

    if (error instanceof ManuscriptDocumentValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unable to save document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
