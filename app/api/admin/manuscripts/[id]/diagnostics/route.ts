import { NextResponse } from "next/server";
import { getManuscriptPipelineDiagnostics } from "@/lib/pipeline/diagnostics";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const diagnostics = await getManuscriptPipelineDiagnostics(id);

    return NextResponse.json(diagnostics);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Pipeline diagnostics failed.";
    const status = message === "Manuscript not found." ? 404 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
