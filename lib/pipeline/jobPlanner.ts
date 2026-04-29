import {
  FULL_MANUSCRIPT_PIPELINE_STEPS,
  type ManuscriptPipelineStep,
  type PipelineCheckpoint
} from "@/lib/pipeline/steps";

export type PlannedPipelineJob = {
  type: ManuscriptPipelineStep;
  idempotencyKey: string;
  dependencyKeys: string[];
  completedFromCheckpoint: boolean;
  metadata: {
    step: ManuscriptPipelineStep;
    order: number;
    pipeline: "FULL_PIPELINE";
  };
};

export function pipelineStepJobKey(manuscriptId: string, step: string) {
  return `manuscript:${manuscriptId}:pipeline-step:${step}`;
}

export function plannedPipelineJobs(
  manuscriptId: string,
  checkpoint: PipelineCheckpoint
): PlannedPipelineJob[] {
  const completed = new Set(checkpoint.completedSteps ?? []);

  return FULL_MANUSCRIPT_PIPELINE_STEPS.map((step, index) => ({
    type: step,
    idempotencyKey: pipelineStepJobKey(manuscriptId, step),
    dependencyKeys:
      index === 0
        ? []
        : [pipelineStepJobKey(manuscriptId, FULL_MANUSCRIPT_PIPELINE_STEPS[index - 1])],
    completedFromCheckpoint: completed.has(step),
    metadata: {
      step,
      order: index + 1,
      pipeline: "FULL_PIPELINE" as const
    }
  }));
}
