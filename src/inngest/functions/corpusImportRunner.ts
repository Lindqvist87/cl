import { runCorpusImportForBook } from "@/lib/corpus/corpusImportRunner";
import { recordWorkerHeartbeat } from "@/lib/pipeline/pipelineJobs";
import { inngest } from "@/src/inngest/client";
import { INNGEST_EVENTS } from "@/src/inngest/events";

export const corpusImportRunner = inngest.createFunction(
  {
    id: "corpus-import-runner",
    triggers: [{ event: INNGEST_EVENTS.CORPUS_IMPORT_REQUESTED }]
  },
  async ({ event, step }) => {
    await step.run("heartbeat corpus import", () =>
      recordWorkerHeartbeat("INNGEST", "RUNNING", {
        task: "corpus-import",
        corpusBookId: event.data.corpusBookId,
        source: event.data.source
      })
    );
    const book = await step.run("profile and chunk corpus book", () =>
      runCorpusImportForBook(event.data.corpusBookId)
    );
    await step.run("heartbeat corpus import complete", () =>
      recordWorkerHeartbeat("INNGEST", "IDLE", {
        task: "corpus-import",
        corpusBookId: event.data.corpusBookId,
        source: event.data.source
      })
    );

    return {
      corpusBookId: book.id,
      ingestionStatus: book.ingestionStatus,
      analysisStatus: book.analysisStatus
    };
  }
);
