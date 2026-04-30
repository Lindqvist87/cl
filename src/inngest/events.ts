import { jsonInput } from "@/lib/json";
import { prisma } from "@/lib/prisma";
import { inngest, INNGEST_DEFAULT_APP_ID } from "@/src/inngest/client";

export const INNGEST_EVENTS = {
  MANUSCRIPT_PIPELINE_STARTED: "manuscript/pipeline.started",
  MANUSCRIPT_JOB_CREATED: "manuscript/job.created",
  MANUSCRIPT_JOB_COMPLETED: "manuscript/job.completed",
  MANUSCRIPT_JOB_FAILED: "manuscript/job.failed",
  CHAPTER_REWRITE_REQUESTED: "manuscript/chapter.rewrite.requested",
  CORPUS_IMPORT_REQUESTED: "corpus/import.requested",
  TREND_IMPORT_REQUESTED: "trend/import.requested"
} as const;

export type ManuscriptPipelineMode = "FULL_PIPELINE" | "RESUME" | "REWRITE_ONLY";

export type InngestEventPayloads = {
  [INNGEST_EVENTS.MANUSCRIPT_PIPELINE_STARTED]: {
    manuscriptId: string;
    requestedBy: string | null;
    mode: ManuscriptPipelineMode;
    createdAt: string;
  };
  [INNGEST_EVENTS.MANUSCRIPT_JOB_CREATED]: {
    jobId: string;
    manuscriptId: string | null;
    corpusBookId: string | null;
    type: string;
  };
  [INNGEST_EVENTS.MANUSCRIPT_JOB_COMPLETED]: {
    jobId: string;
    manuscriptId: string | null;
    corpusBookId: string | null;
    type: string;
  };
  [INNGEST_EVENTS.MANUSCRIPT_JOB_FAILED]: {
    jobId: string;
    manuscriptId: string | null;
    corpusBookId: string | null;
    type: string;
    error: string;
  };
  [INNGEST_EVENTS.CHAPTER_REWRITE_REQUESTED]: {
    manuscriptId: string;
    chapterId: string;
    rewritePlanId: string | null;
  };
  [INNGEST_EVENTS.CORPUS_IMPORT_REQUESTED]: {
    corpusBookId: string;
    source: string;
  };
  [INNGEST_EVENTS.TREND_IMPORT_REQUESTED]: {
    importId: string | null;
    source: string;
  };
};

export type InngestEventName = keyof InngestEventPayloads;

export function isInngestWorkerEnabled() {
  return process.env.ENABLE_INNGEST_WORKER === "true";
}

export function maxJobsPerInngestRun() {
  return positiveIntFromEnv("MAX_JOBS_PER_INNGEST_RUN", 3);
}

export function maxSecondsPerInngestRun() {
  return positiveIntFromEnv("MAX_SECONDS_PER_INNGEST_RUN", 25);
}

export function getInngestRuntimeConfig() {
  const enabled = isInngestWorkerEnabled();
  const devMode = process.env.INNGEST_DEV === "1";
  const eventKeyPresent = Boolean(process.env.INNGEST_EVENT_KEY);
  const signingKeyPresent = Boolean(process.env.INNGEST_SIGNING_KEY);
  const warnings: string[] = [];

  if (enabled && !eventKeyPresent && !devMode) {
    warnings.push("INNGEST_EVENT_KEY is missing; Inngest events cannot be sent.");
  }

  if (enabled && !signingKeyPresent && !devMode) {
    warnings.push("INNGEST_SIGNING_KEY is missing; Inngest functions cannot be invoked safely.");
  }

  const configured = enabled && (devMode || (eventKeyPresent && signingKeyPresent));

  return {
    appId: process.env.INNGEST_APP_ID || INNGEST_DEFAULT_APP_ID,
    enabled,
    configured,
    canSendEvents: enabled && (eventKeyPresent || devMode),
    devMode,
    eventKeyPresent,
    signingKeyPresent,
    serveOrigin: process.env.INNGEST_SERVE_ORIGIN || null,
    maxJobsPerRun: maxJobsPerInngestRun(),
    maxSecondsPerRun: maxSecondsPerInngestRun(),
    warnings
  };
}

export function manuscriptPipelineStartedPayload(input: {
  manuscriptId: string;
  requestedBy?: string | null;
  mode: ManuscriptPipelineMode;
  createdAt?: Date;
}) {
  return {
    manuscriptId: input.manuscriptId,
    requestedBy: input.requestedBy ?? null,
    mode: input.mode,
    createdAt: (input.createdAt ?? new Date()).toISOString()
  };
}

export function jobEventPayload(input: {
  jobId: string;
  manuscriptId?: string | null;
  corpusBookId?: string | null;
  type: string;
}) {
  return {
    jobId: input.jobId,
    manuscriptId: input.manuscriptId ?? null,
    corpusBookId: input.corpusBookId ?? null,
    type: input.type
  };
}

export async function sendInngestEvent<TName extends InngestEventName>(
  name: TName,
  data: InngestEventPayloads[TName]
) {
  const config = getInngestRuntimeConfig();

  if (!config.canSendEvents) {
    await recordInngestEventLog(
      name,
      data,
      "FAILED",
      "Inngest worker is not configured."
    );
    return {
      sent: false,
      ids: [] as string[],
      error: "Inngest worker is not configured."
    };
  }

  try {
    const result = await inngest.send({ name, data });
    await recordInngestEventLog(name, data, "SENT");

    return {
      sent: true,
      ids: result.ids,
      error: null
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send Inngest event.";
    await recordInngestEventLog(name, data, "FAILED", message);

    return {
      sent: false,
      ids: [] as string[],
      error: message
    };
  }
}

export async function recordInngestEventLog(
  eventName: string,
  payload: unknown,
  status: "SENT" | "FAILED",
  error?: string
) {
  try {
    const record = toRecord(payload);
    await prisma.inngestEventLog.create({
      data: {
        eventName,
        manuscriptId: stringOrNull(record.manuscriptId),
        jobId: stringOrNull(record.jobId),
        payload: jsonInput(payload),
        status,
        error
      }
    });
  } catch {
    // Event logging should never make the fallback runner unavailable.
  }
}

function positiveIntFromEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}
