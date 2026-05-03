import type { PipelineStatusDisplay } from "@/lib/pipeline/display";
import { PIPELINE_JOB_STATUS } from "@/lib/pipeline/jobRules";

export type AuthorAnalysisActionMode = "start" | "continue";

export type AuthorAnalysisAction = {
  mode: AuthorAnalysisActionMode;
  endpoint: string;
  label: string;
  runningLabel: string;
};

type AuthorAnalysisActionInput = {
  manuscriptId: string;
  analysisReady: boolean;
  analysisStatus?: string | null;
  pipelineStatus: Pick<
    PipelineStatusDisplay,
    "complete" | "currentJobStatus" | "jobCounts" | "lastError" | "lockStatus"
  >;
};

const RECOVERABLE_JOB_STATUSES = new Set<string>([
  PIPELINE_JOB_STATUS.QUEUED,
  PIPELINE_JOB_STATUS.RETRYING
]);

export function authorAnalysisAction(
  input: AuthorAnalysisActionInput
): AuthorAnalysisAction | null {
  if (input.analysisReady || input.pipelineStatus.complete) {
    return null;
  }

  if (hasTerminalAnalysisFailure(input)) {
    return null;
  }

  if (analysisHasStarted(input)) {
    return isRecoverableQueuedAnalysis(input.pipelineStatus)
      ? continueAction(input.manuscriptId)
      : null;
  }

  return {
    mode: "start",
    endpoint: `/api/manuscripts/${input.manuscriptId}/run-pipeline`,
    label: "Starta analys",
    runningLabel: "Startar..."
  };
}

export function isRecoverableQueuedAnalysis(
  pipelineStatus: AuthorAnalysisActionInput["pipelineStatus"]
) {
  return (
    pipelineStatus.jobCounts.queued > 0 ||
    RECOVERABLE_JOB_STATUSES.has(pipelineStatus.currentJobStatus ?? "") ||
    pipelineStatus.lockStatus?.stale === true
  );
}

function continueAction(manuscriptId: string): AuthorAnalysisAction {
  return {
    mode: "continue",
    endpoint: `/api/manuscripts/${manuscriptId}/resume-pipeline`,
    label: "Fortsätt analys",
    runningLabel: "Fortsätter..."
  };
}

function hasTerminalAnalysisFailure(input: AuthorAnalysisActionInput) {
  return (
    input.analysisStatus === "FAILED" ||
    input.pipelineStatus.jobCounts.failed > 0 ||
    Boolean(input.pipelineStatus.lastError)
  );
}

function analysisHasStarted(input: AuthorAnalysisActionInput) {
  const status = input.analysisStatus ?? null;

  return (
    status === "RUNNING" ||
    input.pipelineStatus.jobCounts.completed > 0 ||
    input.pipelineStatus.jobCounts.running > 0 ||
    input.pipelineStatus.jobCounts.blocked > 0 ||
    input.pipelineStatus.jobCounts.queued > 0
  );
}
