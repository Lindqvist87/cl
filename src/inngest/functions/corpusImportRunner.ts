import { NonRetriableError } from "inngest";
import { ensureCorpusAnalysisJobs } from "@/lib/corpus/corpusAnalysisJobs";
import { runReadyCorpusAnalysisJobs } from "@/lib/corpus/startCorpusAnalysis";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/src/inngest/client";
import {
  getInngestRuntimeConfig,
  INNGEST_EVENTS,
  recordInngestEventLog
} from "@/src/inngest/events";

export const corpusImportRunner = inngest.createFunction(
  {
    id: "corpus-import-runner",
    triggers: [{ event: INNGEST_EVENTS.CORPUS_IMPORT_REQUESTED }]
  },
  async ({ event, step }) => {
    const book = await step.run("validate corpus book", () =>
      prisma.corpusBook.findUnique({
        where: { id: event.data.corpusBookId },
        select: { id: true, sourceId: true }
      })
    );

    if (!book) {
      throw new NonRetriableError("Corpus book not found.");
    }

    await step.run("ensure corpus pipeline jobs", () =>
      ensureCorpusAnalysisJobs(event.data.corpusBookId)
    );

    const config = getInngestRuntimeConfig();
    const batch = await step.run("run bounded corpus pipeline batch", () =>
      runReadyCorpusAnalysisJobs({
        corpusBookId: event.data.corpusBookId,
        maxJobs: config.maxJobsPerRun,
        maxSeconds: config.maxSecondsPerRun,
        workerType: "INNGEST",
        workerId: `inngest-corpus:${event.id ?? Date.now()}`
      })
    );

    if (config.enabled && batch.hasRemainingWork) {
      const payload = {
        corpusBookId: event.data.corpusBookId,
        source: event.data.source || book.sourceId
      };
      await step.sendEvent("continue corpus pipeline", {
        name: INNGEST_EVENTS.CORPUS_IMPORT_REQUESTED,
        data: payload
      });
      await step.run("log corpus continuation event", () =>
        recordInngestEventLog(
          INNGEST_EVENTS.CORPUS_IMPORT_REQUESTED,
          payload,
          "SENT"
        )
      );
    }

    return {
      corpusBookId: event.data.corpusBookId,
      batch
    };
  }
);
