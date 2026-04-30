import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  assertEditorialDecisionScope,
  assertEditorialDecisionStatus
} from "@/lib/editorial/decisions";

export const runtime = "nodejs";

type DecisionUpdateBody = {
  title?: unknown;
  rationale?: unknown;
  status?: unknown;
  scope?: unknown;
  metadata?: unknown;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; decisionId: string }> }
) {
  const { id, decisionId } = await params;
  const body = (await request.json()) as DecisionUpdateBody;
  const existing = await prisma.editorialDecision.findFirst({
    where: {
      id: decisionId,
      manuscriptId: id
    }
  });

  if (!existing) {
    return NextResponse.json({ error: "Decision not found." }, { status: 404 });
  }

  const validated = validateUpdateBody(body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const decision = await prisma.editorialDecision.update({
    where: { id: decisionId },
    data: {
      ...(typeof body.title === "string" && body.title.trim()
        ? { title: body.title.trim() }
        : {}),
      ...(typeof body.rationale === "string" ? { rationale: body.rationale } : {}),
      ...(validated.status ? { status: validated.status } : {}),
      ...(validated.scope ? { scope: validated.scope } : {}),
      ...(body.metadata !== undefined
        ? { metadata: body.metadata as Prisma.InputJsonValue }
        : {})
    }
  });

  return NextResponse.json({ decision });
}

function validateUpdateBody(body: DecisionUpdateBody) {
  try {
    return {
      status: body.status ? assertEditorialDecisionStatus(body.status) : undefined,
      scope: body.scope ? assertEditorialDecisionScope(body.scope) : undefined
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid decision payload."
    };
  }
}
