export const FULL_MANUSCRIPT_PIPELINE_STEPS = [
  "parseAndNormalizeManuscript",
  "splitIntoChapters",
  "splitIntoChunks",
  "createEmbeddingsForChunks",
  "summarizeChunks",
  "summarizeChapters",
  "createManuscriptProfile",
  "runChapterAudits",
  "runWholeBookAudit",
  "compareAgainstCorpus",
  "compareAgainstTrendSignals",
  "createRewritePlan",
  "generateChapterRewriteDrafts"
] as const;

export type ManuscriptPipelineStep = (typeof FULL_MANUSCRIPT_PIPELINE_STEPS)[number];

export type PipelineCheckpoint = {
  completedSteps?: string[];
  currentStep?: string;
  stepMetadata?: Record<string, unknown>;
};

export function normalizeCheckpoint(value: unknown): PipelineCheckpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { completedSteps: [] };
  }

  const checkpoint = value as PipelineCheckpoint;

  return {
    ...checkpoint,
    completedSteps: Array.isArray(checkpoint.completedSteps)
      ? checkpoint.completedSteps
      : [],
    stepMetadata:
      checkpoint.stepMetadata && typeof checkpoint.stepMetadata === "object"
        ? checkpoint.stepMetadata
        : {}
  };
}

export function isStepComplete(
  checkpoint: PipelineCheckpoint,
  step: ManuscriptPipelineStep
) {
  return Boolean(checkpoint.completedSteps?.includes(step));
}

export function markStepStarted(
  checkpoint: PipelineCheckpoint,
  step: ManuscriptPipelineStep
): PipelineCheckpoint {
  return {
    ...normalizeCheckpoint(checkpoint),
    currentStep: step
  };
}

export function markStepProgress(
  checkpoint: PipelineCheckpoint,
  step: ManuscriptPipelineStep,
  metadata?: Record<string, unknown>
): PipelineCheckpoint {
  const normalized = normalizeCheckpoint(checkpoint);
  const existingMetadata =
    normalized.stepMetadata?.[step] &&
    typeof normalized.stepMetadata[step] === "object" &&
    !Array.isArray(normalized.stepMetadata[step])
      ? (normalized.stepMetadata[step] as Record<string, unknown>)
      : {};

  return {
    ...normalized,
    currentStep: step,
    stepMetadata: {
      ...(normalized.stepMetadata ?? {}),
      [step]: {
        ...existingMetadata,
        ...(metadata ?? {}),
        updatedAt: new Date().toISOString()
      }
    }
  };
}

export function markStepComplete(
  checkpoint: PipelineCheckpoint,
  step: ManuscriptPipelineStep,
  metadata?: Record<string, unknown>
): PipelineCheckpoint {
  const normalized = normalizeCheckpoint(checkpoint);
  const completed = new Set(normalized.completedSteps ?? []);
  completed.add(step);

  return {
    ...normalized,
    currentStep: undefined,
    completedSteps: Array.from(completed),
    stepMetadata: {
      ...(normalized.stepMetadata ?? {}),
      [step]: {
        completedAt: new Date().toISOString(),
        ...(metadata ?? {})
      }
    }
  };
}

export function pipelineProgress(checkpoint: unknown) {
  const normalized = normalizeCheckpoint(checkpoint);
  const completed = normalized.completedSteps?.filter((step) =>
    FULL_MANUSCRIPT_PIPELINE_STEPS.includes(step as ManuscriptPipelineStep)
  ).length ?? 0;

  return {
    completed,
    total: FULL_MANUSCRIPT_PIPELINE_STEPS.length,
    percent: Math.round((completed / FULL_MANUSCRIPT_PIPELINE_STEPS.length) * 100)
  };
}
