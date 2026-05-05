import type { PipelineStatusDisplay } from "@/lib/pipeline/display";
import { PIPELINE_JOB_STATUS } from "@/lib/pipeline/jobRules";

export const MANUAL_QUEUED_ANALYSIS_COPY =
  "Analysjobben är köade men körs inte automatiskt i preview. Kör nästa batch manuellt för att fortsätta.";

export type OperatorEnv = {
  ENABLE_INNGEST_WORKER?: string;
  NODE_ENV?: string;
  SHOW_OPERATOR_TOOLS?: string;
  VERCEL_ENV?: string;
};

export function operatorToolsVisibilityFromEnv(env: OperatorEnv) {
  const showDeveloperAdminTools = env.NODE_ENV !== "production";
  const showSafeManualRunner =
    envFlagDisabled(env.ENABLE_INNGEST_WORKER) ||
    env.VERCEL_ENV === "preview" ||
    envFlagEnabled(env.SHOW_OPERATOR_TOOLS);

  return {
    showDeveloperAdminTools,
    showOperatorTools: showDeveloperAdminTools || showSafeManualRunner,
    showSafeManualRunner
  };
}

export function manuscriptManualRunEndpoint(manuscriptId: string) {
  return `/api/admin/manuscripts/${manuscriptId}/run-jobs`;
}

export function isManualQueuedAnalysisMode(input: {
  analysisStatus?: string | null;
  inngestEnabled: boolean;
  pipelineStatus: Pick<
    PipelineStatusDisplay,
    "complete" | "currentJobStatus" | "jobCounts"
  >;
}) {
  if (input.inngestEnabled || input.pipelineStatus.complete) {
    return false;
  }

  const currentJobStatus = input.pipelineStatus.currentJobStatus?.toUpperCase();
  const hasQueuedWork =
    input.pipelineStatus.jobCounts.queued > 0 ||
    currentJobStatus === PIPELINE_JOB_STATUS.QUEUED ||
    currentJobStatus === PIPELINE_JOB_STATUS.RETRYING;

  return hasQueuedWork && input.pipelineStatus.jobCounts.running === 0;
}

export function shouldAutoRunQueuedAnalysisAfterUpload(input: {
  requested: boolean;
  analysisReady: boolean;
  showOperatorTools: boolean;
  pipelineStatus: Pick<
    PipelineStatusDisplay,
    "complete" | "currentJobStatus" | "jobCounts"
  >;
}) {
  if (
    !input.requested ||
    input.analysisReady ||
    input.pipelineStatus.complete ||
    !input.showOperatorTools
  ) {
    return false;
  }

  const currentJobStatus = input.pipelineStatus.currentJobStatus?.toUpperCase();
  const hasQueuedWork =
    input.pipelineStatus.jobCounts.queued > 0 ||
    currentJobStatus === PIPELINE_JOB_STATUS.QUEUED ||
    currentJobStatus === PIPELINE_JOB_STATUS.RETRYING;

  return (
    hasQueuedWork &&
    input.pipelineStatus.jobCounts.running === 0 &&
    input.pipelineStatus.jobCounts.failed === 0
  );
}

export function analysisStatusLabel(input: {
  analysisStatus: string;
  manualQueuedMode: boolean;
}) {
  if (
    input.manualQueuedMode &&
    input.analysisStatus.toUpperCase() === "RUNNING"
  ) {
    return "Analys köad";
  }

  return null;
}

function envFlagEnabled(value: string | undefined) {
  return value?.toLowerCase() === "true" || value === "1";
}

function envFlagDisabled(value: string | undefined) {
  return value?.toLowerCase() === "false" || value === "0";
}
