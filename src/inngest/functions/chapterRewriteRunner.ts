import {
  ensureChapterRewriteJob,
  runPipelineJob
} from "@/lib/pipeline/pipelineJobs";
import { inngest } from "@/src/inngest/client";
import {
  INNGEST_EVENTS,
  jobEventPayload,
  recordInngestEventLog
} from "@/src/inngest/events";

export const chapterRewriteRunner = inngest.createFunction(
  {
    id: "chapter-rewrite-runner",
    triggers: [{ event: INNGEST_EVENTS.CHAPTER_REWRITE_REQUESTED }]
  },
  async ({ event, step }) => {
    const job = await step.run("create or find chapter rewrite job", () =>
      ensureChapterRewriteJob({
        manuscriptId: event.data.manuscriptId,
        chapterId: event.data.chapterId,
        rewritePlanId: event.data.rewritePlanId,
        requestId: event.id
      })
    );
    const result = await step.run("run chapter rewrite job", () =>
      runPipelineJob(job.id, {
        workerId: `inngest-rewrite:${event.id ?? Date.now()}`,
        maxItemsPerStep: 1
      })
    );

    if (result.status === "completed" && result.jobId && result.type) {
      const payload = jobEventPayload({
        jobId: result.jobId,
        manuscriptId: result.manuscriptId,
        type: result.type
      });
      await step.sendEvent("emit rewrite job completed", {
        name: INNGEST_EVENTS.MANUSCRIPT_JOB_COMPLETED,
        data: payload
      });
      await step.run("log rewrite completion", () =>
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
          type: result.type
        }),
        error: result.error ?? "Chapter rewrite job failed."
      };
      await step.sendEvent("emit rewrite job failed", {
        name: INNGEST_EVENTS.MANUSCRIPT_JOB_FAILED,
        data: payload
      });
      await step.run("log rewrite failure", () =>
        recordInngestEventLog(INNGEST_EVENTS.MANUSCRIPT_JOB_FAILED, payload, "SENT")
      );
    }

    if (result.status === "retrying" && result.jobId && result.type) {
      await step.sleep("wait before rewrite retry", "30s");
      await step.sendEvent("retry rewrite job", {
        name: INNGEST_EVENTS.MANUSCRIPT_JOB_CREATED,
        data: jobEventPayload({
          jobId: result.jobId,
          manuscriptId: result.manuscriptId,
          type: result.type
        })
      });
    }

    return result;
  }
);
