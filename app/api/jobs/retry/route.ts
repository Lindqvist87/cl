import { NextResponse } from "next/server";
import { retryPipelineJob } from "@/lib/pipeline/pipelineJobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.jobId !== "string" || !body.jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  const job = await retryPipelineJob(body.jobId);
  return NextResponse.json({ jobId: job.id, status: job.status });
}
