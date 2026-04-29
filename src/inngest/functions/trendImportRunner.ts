import { recordWorkerHeartbeat } from "@/lib/pipeline/pipelineJobs";
import { runTrendImport } from "@/lib/trends/trendImportRunner";
import { inngest } from "@/src/inngest/client";
import { INNGEST_EVENTS } from "@/src/inngest/events";

export const trendImportRunner = inngest.createFunction(
  {
    id: "trend-import-runner",
    triggers: [{ event: INNGEST_EVENTS.TREND_IMPORT_REQUESTED }]
  },
  async ({ event, step }) => {
    await step.run("heartbeat trend import", () =>
      recordWorkerHeartbeat("INNGEST", "RUNNING", {
        task: "trend-import",
        importId: event.data.importId,
        source: event.data.source
      })
    );
    const result = await step.run("import trend metadata", () =>
      runTrendImport({
        importId: event.data.importId,
        source: event.data.source
      })
    );
    await step.run("heartbeat trend import complete", () =>
      recordWorkerHeartbeat("INNGEST", "IDLE", {
        task: "trend-import",
        importId: event.data.importId,
        source: event.data.source
      })
    );

    return result;
  }
);
