import { NonRetriableError } from "inngest";
import {
  ensureManuscriptPipelineJobs,
  runReadyPipelineJobs
} from "@/lib/pipeline/pipelineJobs";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/src/inngest/client";
import {
  getInngestRuntimeConfig,
  INNGEST_EVENTS,
  jobEventPayload,
  manuscriptPipelineStartedPayload,
  recordInngestEventLog
} from "@/src/inngest/events";

export const manuscriptPipelineRunner = inngest.createFunction(
  {
    id: "manuscript-pipeline-runner",
    triggers: [{ event: INNGEST_EVENTS.MANUSCRIPT_PIPELINE_STARTED }]
  },
  async ({ event, step }) => {
    const data = event.data;
    const manuscript = await step.run("validate manuscript", () =>
      prisma.manuscript.findUnique({
        where: { id: data.manuscriptId },
        select: { id: true }
      })
    );

    if (!manuscript) {
      throw new NonRetriableError("Manuscript not found.");
    }

    await step.run("ensure pipeline jobs", () =>
      ensureManuscriptPipelineJobs(data.manuscriptId, data.mode)
    );

    const config = getInngestRuntimeConfig();
    const batch = await step.run("run bounded pipeline batch", () =>
      runReadyPipelineJobs({
        manuscriptId: data.manuscriptId,
        maxJobs: config.maxJobsPerRun,
        maxSeconds: config.maxSecondsPerRun,
        workerType: "INNGEST",
        workerId: `inngest:${event.id ?? Date.now()}`
      })
    );

    if (batch.readyJobIds.length > 0) {
      const jobs = await step.run("load ready job events", () =>
        prisma.pipelineJob.findMany({
          where: { id: { in: batch.readyJobIds } },
          select: { id: true, manuscriptId: true, type: true }
        })
      );

      await step.sendEvent(
        "emit ready job events",
        jobs.map((job) => ({
          name: INNGEST_EVENTS.MANUSCRIPT_JOB_CREATED,
          data: jobEventPayload({
            jobId: job.id,
            manuscriptId: job.manuscriptId,
            type: job.type
          })
        }))
      );
    }

    if (config.enabled && batch.remainingReadyJobs > 0) {
      const payload = manuscriptPipelineStartedPayload({
        manuscriptId: data.manuscriptId,
        requestedBy: data.requestedBy,
        mode: "RESUME"
      });
      await step.sendEvent("continue manuscript pipeline", {
        name: INNGEST_EVENTS.MANUSCRIPT_PIPELINE_STARTED,
        data: payload
      });
      await step.run("log continuation event", () =>
        recordInngestEventLog(
          INNGEST_EVENTS.MANUSCRIPT_PIPELINE_STARTED,
          payload,
          "SENT"
        )
      );
    }

    return batch;
  }
);
