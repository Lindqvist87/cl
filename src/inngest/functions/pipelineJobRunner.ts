import { corpusBookIdFromPipelineJob } from "@/lib/corpus/corpusAnalysisJobs";
import { runPipelineJob } from "@/lib/pipeline/pipelineJobs";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/src/inngest/client";
import {
  INNGEST_EVENTS,
  jobEventPayload,
  recordInngestEventLog
} from "@/src/inngest/events";

export const pipelineJobRunner = inngest.createFunction(
  {
    id: "pipeline-job-runner",
    triggers: [{ event: INNGEST_EVENTS.MANUSCRIPT_JOB_CREATED }]
  },
  async ({ event, step }) => {
    const result = await step.run("run one pipeline job", () =>
      runPipelineJob(event.data.jobId, {
        workerId: `inngest-job:${event.id ?? Date.now()}`,
        maxItemsPerStep: 4
      })
    );

    if (result.status === "completed" && result.jobId && result.type) {
      const payload = jobEventPayload({
        jobId: result.jobId,
        manuscriptId: result.manuscriptId,
        corpusBookId: result.corpusBookId,
        type: result.type
      });
      await step.sendEvent("emit job completed", {
        name: INNGEST_EVENTS.MANUSCRIPT_JOB_COMPLETED,
        data: payload
      });
      await step.run("log job completed", () =>
        recordInngestEventLog(
          INNGEST_EVENTS.MANUSCRIPT_JOB_COMPLETED,
          payload,
          "SENT"
        )
      );
    }

    if (
      (result.status === "failed" || result.status === "retrying") &&
      result.jobId &&
      result.type
    ) {
      const payload = {
        ...jobEventPayload({
          jobId: result.jobId,
          manuscriptId: result.manuscriptId,
          corpusBookId: result.corpusBookId,
          type: result.type
        }),
        error: result.error ?? "Pipeline job failed."
      };
      await step.sendEvent("emit job failed", {
        name: INNGEST_EVENTS.MANUSCRIPT_JOB_FAILED,
        data: payload
      });
      await step.run("log job failed", () =>
        recordInngestEventLog(
          INNGEST_EVENTS.MANUSCRIPT_JOB_FAILED,
          payload,
          "SENT"
        )
      );
    }

    if (result.status === "queued" && result.jobId && result.type) {
      await step.sendEvent("continue same job", {
        name: INNGEST_EVENTS.MANUSCRIPT_JOB_CREATED,
        data: jobEventPayload({
          jobId: result.jobId,
          manuscriptId: result.manuscriptId,
          corpusBookId: result.corpusBookId,
          type: result.type
        })
      });
    }

    if (result.readyJobIds.length > 0) {
      const jobs = await step.run("load newly ready jobs", () =>
        prisma.pipelineJob.findMany({
          where: { id: { in: result.readyJobIds } },
          select: {
            id: true,
            idempotencyKey: true,
            manuscriptId: true,
            metadata: true,
            type: true
          }
        })
      );

      await step.sendEvent(
        "emit newly ready jobs",
        jobs.map((job) => ({
          name: INNGEST_EVENTS.MANUSCRIPT_JOB_CREATED,
          data: jobEventPayload({
            jobId: job.id,
            manuscriptId: job.manuscriptId,
            corpusBookId: corpusBookIdFromPipelineJob(job),
            type: job.type
          })
        }))
      );
    }

    if (result.status === "retrying" && result.jobId && result.type) {
      await step.sleep("wait before retrying job", "30s");
      await step.sendEvent("retry job after backoff", {
        name: INNGEST_EVENTS.MANUSCRIPT_JOB_CREATED,
        data: jobEventPayload({
          jobId: result.jobId,
          manuscriptId: result.manuscriptId,
          corpusBookId: result.corpusBookId,
          type: result.type
        })
      });
    }

    return result;
  }
);
