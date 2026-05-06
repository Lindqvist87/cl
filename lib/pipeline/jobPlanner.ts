import {
  FULL_MANUSCRIPT_PIPELINE_STEPS,
  type ManuscriptPipelineStep,
  type PipelineCheckpoint
} from "@/lib/pipeline/steps";
import type { LockedAnalysisSnapshot } from "@/lib/pipeline/analysisSnapshot";

export type PlannedPipelineJob = {
  type: ManuscriptPipelineStep;
  idempotencyKey: string;
  dependencyKeys: string[];
  completedFromCheckpoint: boolean;
  requeueStaleCompletion: boolean;
  metadata: {
    step: ManuscriptPipelineStep;
    order: number;
    pipeline: "FULL_PIPELINE";
    snapshotId?: string;
    textHash?: string;
    documentRevision?: number;
  };
};

export function pipelineStepJobKey(
  manuscriptId: string,
  step: string,
  snapshot?: Pick<LockedAnalysisSnapshot, "id" | "textHash">
) {
  const snapshotKey = snapshot
    ? `:snapshot:${snapshot.id}:${snapshot.textHash.slice(0, 12)}`
    : "";
  return `manuscript:${manuscriptId}${snapshotKey}:pipeline-step:${step}`;
}

export function plannedPipelineJobs(
  manuscriptId: string,
  checkpoint: PipelineCheckpoint,
  snapshot?: LockedAnalysisSnapshot
): PlannedPipelineJob[] {
  const completed = new Set(checkpoint.completedSteps ?? []);

  return FULL_MANUSCRIPT_PIPELINE_STEPS.map((step, index) => ({
    type: step,
    idempotencyKey: pipelineStepJobKey(manuscriptId, step, snapshot),
    dependencyKeys:
      index === 0
        ? []
        : [
            pipelineStepJobKey(
              manuscriptId,
              FULL_MANUSCRIPT_PIPELINE_STEPS[index - 1],
              snapshot
            )
          ],
    completedFromCheckpoint: completed.has(step) &&
      isCheckpointCompletionCurrent(checkpoint, completed, step),
    requeueStaleCompletion: completed.has(step) &&
      !isCheckpointCompletionCurrent(checkpoint, completed, step),
    metadata: {
      step,
      order: index + 1,
      pipeline: "FULL_PIPELINE" as const,
      snapshotId: snapshot?.id,
      textHash: snapshot?.textHash,
      documentRevision: snapshot?.documentRevision
    }
  }));
}

function isCheckpointCompletionCurrent(
  checkpoint: PipelineCheckpoint,
  completed: Set<string>,
  step: ManuscriptPipelineStep
) {
  if (step !== "createNextBestEditorialActions") {
    return true;
  }

  if (!completed.has("createRewritePlan")) {
    return false;
  }

  const actionsCompletedAt = stepCompletedAt(
    checkpoint,
    "createNextBestEditorialActions"
  );
  const rewriteCompletedAt = stepCompletedAt(checkpoint, "createRewritePlan");

  return Boolean(
    actionsCompletedAt &&
      rewriteCompletedAt &&
      actionsCompletedAt.getTime() >= rewriteCompletedAt.getTime()
  );
}

function stepCompletedAt(
  checkpoint: PipelineCheckpoint,
  step: ManuscriptPipelineStep
) {
  const metadata = checkpoint.stepMetadata?.[step];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const completedAt = (metadata as Record<string, unknown>).completedAt;
  if (typeof completedAt !== "string") {
    return null;
  }

  const parsed = new Date(completedAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
