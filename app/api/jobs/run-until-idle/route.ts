import { NextResponse } from "next/server";
import { runReadyPipelineJobs } from "@/lib/pipeline/pipelineJobs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const result = await runReadyPipelineJobs({
    manuscriptId: stringOrUndefined(body.manuscriptId),
    corpusBookId: stringOrUndefined(body.corpusBookId),
    maxJobs: numberOrUndefined(body.maxJobs) ?? 10,
    maxSeconds: numberOrUndefined(body.maxSeconds) ?? 60,
    workerType: "MANUAL",
    workerId: "manual:run-until-idle"
  });

  return NextResponse.json(result);
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
