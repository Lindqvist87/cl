import { runReadyPipelineJobs } from "@/lib/pipeline/pipelineJobs";
import {
  FULL_MANUSCRIPT_PIPELINE_STEPS,
  normalizeCheckpoint,
  pipelineProgress
} from "@/lib/pipeline/steps";
import { prisma } from "@/lib/prisma";

const DEFAULT_MAX_JOBS = 5;
const DEFAULT_MAX_SECONDS = 240;
const DEFAULT_MAX_ITEMS_PER_STEP = 4;

export type ManuscriptAdminRunJobsBody = {
  maxJobs?: unknown;
  maxSeconds?: unknown;
  maxItemsPerStep?: unknown;
};

export const manuscriptAdminJobRunner = {
  async run(manuscriptId: string, body: ManuscriptAdminRunJobsBody = {}) {
    const result = await runReadyPipelineJobs(
      manuscriptAdminRunJobOptions(manuscriptId, body)
    );

    return {
      ...result,
      progress: await getManuscriptRunProgress(manuscriptId)
    };
  }
};

export function manuscriptAdminRunJobOptions(
  manuscriptId: string,
  body: ManuscriptAdminRunJobsBody = {}
) {
  return {
    manuscriptId,
    maxJobs: numberOrDefault(body.maxJobs, DEFAULT_MAX_JOBS),
    maxSeconds: numberOrDefault(body.maxSeconds, DEFAULT_MAX_SECONDS),
    maxItemsPerStep: numberOrDefault(
      body.maxItemsPerStep,
      DEFAULT_MAX_ITEMS_PER_STEP
    ),
    workerType: "MANUAL" as const,
    workerId: `manual:manuscript:${manuscriptId}`
  };
}

async function getManuscriptRunProgress(manuscriptId: string) {
  const run = await prisma.analysisRun.findFirst({
    where: { manuscriptId },
    orderBy: { createdAt: "desc" },
    select: { checkpoint: true }
  });
  const checkpoint = normalizeCheckpoint(run?.checkpoint);
  const currentStep = stepOrUndefined(checkpoint.currentStep);
  const metadata = currentStep
    ? recordOrNull(checkpoint.stepMetadata?.[currentStep])
    : null;
  const summary = pipelineProgress(checkpoint);

  return {
    ...summary,
    currentStep,
    analyzed: numberOrUndefined(metadata?.analyzed),
    remaining: numberOrUndefined(metadata?.remaining),
    complete: booleanOrUndefined(metadata?.complete)
  };
}

function numberOrDefault(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback;
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanOrUndefined(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function recordOrNull(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stepOrUndefined(value: unknown) {
  return typeof value === "string" &&
    FULL_MANUSCRIPT_PIPELINE_STEPS.includes(
      value as (typeof FULL_MANUSCRIPT_PIPELINE_STEPS)[number]
    )
    ? value
    : undefined;
}
