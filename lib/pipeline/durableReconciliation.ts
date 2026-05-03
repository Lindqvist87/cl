import {
  CORE_MANUSCRIPT_PIPELINE_STEPS,
  isManuscriptPipelineStep,
  normalizeCheckpoint,
  type ManuscriptPipelineStep,
  type PipelineCheckpoint
} from "@/lib/pipeline/steps";
import type { ChunkSummaryProgress } from "@/lib/pipeline/chunkSummaryProgress";

const CHUNK_ANALYSIS_STEP = "summarizeChunks" satisfies ManuscriptPipelineStep;

export type DurablePipelineReconciliation = {
  checkpoint: PipelineCheckpoint;
  changed: boolean;
  reopenFromStep: ManuscriptPipelineStep | null;
  checkpointPhase: ManuscriptPipelineStep | null;
  durablePhase: ManuscriptPipelineStep | null;
  chunkAnalysisTotal: number;
  chunkAnalysisCompleted: number;
  chunkAnalysisRemaining: number;
};

export function reconcileCheckpointWithDurableState(input: {
  checkpoint: unknown;
  chunkAnalysis: ChunkSummaryProgress;
}): DurablePipelineReconciliation {
  const checkpoint = normalizeCheckpoint(input.checkpoint);
  const checkpointPhase = isManuscriptPipelineStep(checkpoint.currentStep)
    ? checkpoint.currentStep
    : null;
  const chunkAnalysisTotal = input.chunkAnalysis.total;
  const chunkAnalysisCompleted = input.chunkAnalysis.summarized;
  const chunkAnalysisRemaining = Math.max(
    chunkAnalysisTotal - chunkAnalysisCompleted,
    0
  );

  if (chunkAnalysisTotal <= 0 || chunkAnalysisCompleted >= chunkAnalysisTotal) {
    return {
      checkpoint,
      changed: false,
      reopenFromStep: null,
      checkpointPhase,
      durablePhase: checkpointPhase,
      chunkAnalysisTotal,
      chunkAnalysisCompleted,
      chunkAnalysisRemaining
    };
  }

  const existingMetadata =
    checkpoint.stepMetadata?.[CHUNK_ANALYSIS_STEP] &&
    typeof checkpoint.stepMetadata[CHUNK_ANALYSIS_STEP] === "object" &&
    !Array.isArray(checkpoint.stepMetadata[CHUNK_ANALYSIS_STEP])
      ? (checkpoint.stepMetadata[CHUNK_ANALYSIS_STEP] as Record<string, unknown>)
      : {};
  const reconciledCheckpoint: PipelineCheckpoint = {
    ...checkpoint,
    currentStep: CHUNK_ANALYSIS_STEP,
    completedSteps: completedStepsBefore(checkpoint, CHUNK_ANALYSIS_STEP),
    stepMetadata: {
      ...(checkpoint.stepMetadata ?? {}),
      [CHUNK_ANALYSIS_STEP]: {
        ...existingMetadata,
        summarized: chunkAnalysisCompleted,
        total: chunkAnalysisTotal,
        remaining: chunkAnalysisRemaining,
        complete: false
      }
    }
  };

  return {
    checkpoint: reconciledCheckpoint,
    changed: JSON.stringify(checkpoint) !== JSON.stringify(reconciledCheckpoint),
    reopenFromStep: CHUNK_ANALYSIS_STEP,
    checkpointPhase,
    durablePhase: CHUNK_ANALYSIS_STEP,
    chunkAnalysisTotal,
    chunkAnalysisCompleted,
    chunkAnalysisRemaining
  };
}

export function stepIndex(step: unknown) {
  return typeof step === "string"
    ? CORE_MANUSCRIPT_PIPELINE_STEPS.indexOf(
        step as (typeof CORE_MANUSCRIPT_PIPELINE_STEPS)[number]
      )
    : -1;
}

function completedStepsBefore(
  checkpoint: PipelineCheckpoint,
  firstIncompleteStep: ManuscriptPipelineStep
) {
  const firstIncompleteIndex = stepIndex(firstIncompleteStep);

  return (checkpoint.completedSteps ?? []).filter((step) => {
    const index = stepIndex(step);
    return index >= 0 && index < firstIncompleteIndex;
  });
}
