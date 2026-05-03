// Editorial output flow: import stores chapters/scenes/paragraphs/chunks, local
// chunk/chapter passes create findings with source anchors, section/global passes
// group those findings into report/rewrite artifacts, and the author workspace
// derives next action + recommendation cards from stored artifacts only.
export const CORE_MANUSCRIPT_PIPELINE_STEPS = [
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
  "createRewritePlan"
] as const;

export const OPTIONAL_MANUSCRIPT_PIPELINE_STEPS = [
  "generateChapterRewriteDrafts"
] as const;

export const FULL_MANUSCRIPT_PIPELINE_STEPS = CORE_MANUSCRIPT_PIPELINE_STEPS;

export const MANUSCRIPT_PIPELINE_STEPS = [
  ...CORE_MANUSCRIPT_PIPELINE_STEPS,
  ...OPTIONAL_MANUSCRIPT_PIPELINE_STEPS
] as const;

export type CoreManuscriptPipelineStep =
  (typeof CORE_MANUSCRIPT_PIPELINE_STEPS)[number];
export type OptionalManuscriptPipelineStep =
  (typeof OPTIONAL_MANUSCRIPT_PIPELINE_STEPS)[number];
export type ManuscriptPipelineStep = (typeof MANUSCRIPT_PIPELINE_STEPS)[number];

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

export function isManuscriptPipelineStep(
  step: unknown
): step is ManuscriptPipelineStep {
  return (
    typeof step === "string" &&
    MANUSCRIPT_PIPELINE_STEPS.includes(step as ManuscriptPipelineStep)
  );
}

export function isCoreManuscriptPipelineStep(
  step: unknown
): step is CoreManuscriptPipelineStep {
  return (
    typeof step === "string" &&
    CORE_MANUSCRIPT_PIPELINE_STEPS.includes(step as CoreManuscriptPipelineStep)
  );
}

export function isOptionalManuscriptPipelineStep(
  step: unknown
): step is OptionalManuscriptPipelineStep {
  return (
    typeof step === "string" &&
    OPTIONAL_MANUSCRIPT_PIPELINE_STEPS.includes(
      step as OptionalManuscriptPipelineStep
    )
  );
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
    CORE_MANUSCRIPT_PIPELINE_STEPS.includes(step as CoreManuscriptPipelineStep)
  ).length ?? 0;

  return {
    completed,
    total: CORE_MANUSCRIPT_PIPELINE_STEPS.length,
    percent: Math.round((completed / CORE_MANUSCRIPT_PIPELINE_STEPS.length) * 100)
  };
}
