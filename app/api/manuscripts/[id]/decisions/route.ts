import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  type EditorialDecisionScope,
  assertEditorialDecisionScope,
  assertEditorialDecisionStatus
} from "@/lib/editorial/decisions";

export const runtime = "nodejs";

type DecisionBody = {
  chapterId?: unknown;
  findingId?: unknown;
  rewritePlanId?: unknown;
  title?: unknown;
  rationale?: unknown;
  status?: unknown;
  scope?: unknown;
  metadata?: unknown;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const chapterId = request.nextUrl.searchParams.get("chapterId");
  const decisions = await prisma.editorialDecision.findMany({
    where: {
      manuscriptId: id,
      ...(chapterId ? { chapterId } : {})
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  });

  return NextResponse.json({ decisions });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as DecisionBody;
  const validated = validateDecisionBody(body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { title, status, scope } = validated;
  const chapterId = optionalString(body.chapterId);
  const findingId = optionalString(body.findingId);
  const rewritePlanId = optionalString(body.rewritePlanId);
  const rationale = optionalString(body.rationale);
  const metadata = inputJson(body.metadata);

  const manuscript = await prisma.manuscript.findUnique({
    where: { id },
    select: { id: true }
  });

  if (!manuscript) {
    return NextResponse.json({ error: "Manuscript not found." }, { status: 404 });
  }

  const referenceError = await validateReferences({
    manuscriptId: id,
    chapterId,
    findingId,
    rewritePlanId
  });

  if (referenceError) {
    return NextResponse.json({ error: referenceError }, { status: 400 });
  }

  const existing = await prisma.editorialDecision.findFirst({
    where: decisionLookupWhere({
      manuscriptId: id,
      chapterId,
      findingId,
      rewritePlanId,
      title,
      scope
    })
  });

  const decision = existing
    ? await prisma.editorialDecision.update({
        where: { id: existing.id },
        data: {
          title,
          rationale,
          status,
          scope,
          metadata
        }
      })
    : await prisma.editorialDecision.create({
        data: {
          manuscriptId: id,
          chapterId,
          findingId,
          rewritePlanId,
          title,
          rationale,
          status,
          scope,
          metadata
        }
      });

  return NextResponse.json({ decision });
}

function validateDecisionBody(body: DecisionBody) {
  try {
    return {
      title: stringField(body.title, "Decision title is required."),
      status: assertEditorialDecisionStatus(body.status ?? "NEEDS_REVIEW"),
      scope: assertEditorialDecisionScope(body.scope ?? "CHAPTER")
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid decision payload."
    };
  }
}

async function validateReferences({
  manuscriptId,
  chapterId,
  findingId,
  rewritePlanId
}: {
  manuscriptId: string;
  chapterId?: string;
  findingId?: string;
  rewritePlanId?: string;
}) {
  if (chapterId) {
    const chapter = await prisma.manuscriptChapter.findFirst({
      where: { id: chapterId, manuscriptId },
      select: { id: true }
    });

    if (!chapter) {
      return "Chapter does not belong to this manuscript.";
    }
  }

  if (findingId) {
    const finding = await prisma.finding.findFirst({
      where: { id: findingId, manuscriptId },
      select: { id: true }
    });

    if (!finding) {
      return "Finding does not belong to this manuscript.";
    }
  }

  if (rewritePlanId) {
    const rewritePlan = await prisma.rewritePlan.findFirst({
      where: { id: rewritePlanId, manuscriptId },
      select: { id: true }
    });

    if (!rewritePlan) {
      return "Rewrite plan does not belong to this manuscript.";
    }
  }

  return null;
}

function decisionLookupWhere({
  manuscriptId,
  chapterId,
  findingId,
  rewritePlanId,
  title,
  scope
}: {
  manuscriptId: string;
  chapterId?: string;
  findingId?: string;
  rewritePlanId?: string;
  title: string;
  scope: EditorialDecisionScope;
}): Prisma.EditorialDecisionWhereInput {
  if (findingId) {
    return { manuscriptId, findingId };
  }

  if (rewritePlanId) {
    return {
      manuscriptId,
      rewritePlanId,
      chapterId: chapterId ?? null
    };
  }

  return {
    manuscriptId,
    chapterId: chapterId ?? null,
    title,
    scope
  };
}

function stringField(value: unknown, message: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }

  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function inputJson(value: unknown) {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}
