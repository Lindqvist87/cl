export const PIPELINE_DIAGNOSTICS_REFRESH_EVENT =
  "manuscript-pipeline:refresh-diagnostics";

export type PipelineDiagnosticsRefreshDetail = {
  manuscriptId: string;
  result?: unknown;
  autoRunnerActive?: boolean;
  phase?: "starting" | "running" | "failed" | "idle";
};
