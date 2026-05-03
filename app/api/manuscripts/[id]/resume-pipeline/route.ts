import { NextResponse } from "next/server";
import { manuscriptAdminJobRunner } from "@/lib/server/manuscriptAdminJobs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await manuscriptAdminJobRunner.run(id, {});

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Pipeline resume failed.";
    const status = message === "Manuscript not found." ? 404 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
