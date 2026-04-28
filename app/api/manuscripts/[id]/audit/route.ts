import { NextResponse } from "next/server";
import { runManuscriptAudit } from "@/lib/analysis/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const report = await runManuscriptAudit(id);
    return NextResponse.json({
      reportId: report.id,
      manuscriptId: report.manuscriptId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audit failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
