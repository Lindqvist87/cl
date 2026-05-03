import { AnalysisPassType } from "@prisma/client";
import {
  CORE_MANUSCRIPT_PIPELINE_STEPS,
  MANUSCRIPT_PIPELINE_STEPS,
  isManuscriptPipelineStep,
  normalizeCheckpoint,
  type ManuscriptPipelineStep,
  type PipelineCheckpoint
} from "@/lib/pipeline/steps";
import { PIPELINE_JOB_STATUS } from "@/lib/pipeline/jobRules";
import { prisma } from "@/lib/prisma";

const COMPLETED_OUTPUT_STATUS = "COMPLETED";
const ACTIVE_JOB_STATUSES = new Set<string>([
  PIPELINE_JOB_STATUS.QUEUED,
  PIPELINE_JOB_STATUS.RUNNING,
  PIPELINE_JOB_STATUS.RETRYING,
  PIPELINE_JOB_STATUS.BLOCKED,
  PIPELINE_JOB_STATUS.FAILED
]);
const DONE_EMBEDDING_STATUSES = new Set(["stored", "empty", "skipped"]);
const DONE_REWRITE_STATUSES = new Set(["DRAFT", "ACCEPTED"]);

export type DurablePhaseState = {
  phase: ManuscriptPipelineStep;
  total: number;
  completed: number;
  remaining: number;
  isComplete: boolean;
  blockingReason: string | null;
  recoverable: boolean;
  nextJobType: ManuscriptPipelineStep | null;
  inputDependency: ManuscriptPipelineStep | "sourceText" | null;
  expectedOutput: string;
};

export type DurablePipelineJobSnapshot = {
  id: string;
  type: string;
  status: string;
  dependencyIds?: unknown;
};

export type DurablePipelineSnapshot = {
  manuscript?: {
    id?: string;
    originalText?: string | null;
    wordCount?: number | null;
  } | null;
  chapters?: Array<{
    id: string;
    summary?: string | null;
    text?: string | null;
  }>;
  chunks?: Array<{
    id: string;
    summary?: string | null;
    localMetrics?: unknown;
  }>;
  outputs?: Array<{
    passType: string;
    scopeType?: string | null;
    scopeId?: string | null;
    status?: string | null;
    output?: unknown;
    rawText?: string | null;
  }>;
  profile?: unknown | null;
  reports?: Array<{ id?: string; runId?: string | null }>;
  rewritePlans?: Array<{ id: string; analysisRunId?: string | null }>;
  chapterRewrites?: Array<{
    id: string;
    chapterId?: string | null;
    rewritePlanId?: string | null;
    status?: string | null;
  }>;
  jobs?: DurablePipelineJobSnapshot[];
  checkpoint?: unknown;
};

export type DurablePipelineState = {
  phases: DurablePhaseState[];
  phaseByStep: Record<ManuscriptPipelineStep, DurablePhaseState>;
  completedSteps: ManuscriptPipelineStep[];
  currentPhase: ManuscriptPipelineStep | null;
  currentPhaseState: DurablePhaseState | null;
  nextJobType: ManuscriptPipelineStep | null;
  checkpointPhase: ManuscriptPipelineStep | null;
  jobStatusPhase: string | null;
  reconciledCheckpoint: PipelineCheckpoint;
  checkpointChanged: boolean;
  staleMetadataDetected: boolean;
  mismatchWarnings: string[];
  recoverable: boolean;
  complete: boolean;
  evaluationIncomplete: boolean;
};

export async function getManuscriptDurablePipelineState(input: {
  manuscriptId: string;
  runId?: string | null;
  checkpoint?: unknown;
  jobs?: DurablePipelineJobSnapshot[];
}): Promise<DurablePipelineState> {
  const manuscript = await prisma.manuscript.findUnique({
    where: { id: input.manuscriptId },
    include: {
      chapters: {
        select: { id: true, summary: true, text: true },
        orderBy: { order: "asc" }
      },
      chunks: {
        select: { id: true, summary: true, localMetrics: true },
        orderBy: { chunkIndex: "asc" }
      },
      profile: true,
      outputs: input.runId
        ? {
            where: { runId: input.runId },
            select: {
              passType: true,
              scopeType: true,
              scopeId: true,
              status: true,
              output: true,
              rawText: true
            }
          }
        : {
            select: {
              passType: true,
              scopeType: true,
              scopeId: true,
              status: true,
              output: true,
              rawText: true
            }
          },
      reports: input.runId
        ? {
            where: { runId: input.runId },
            select: { id: true, runId: true },
            take: 1
          }
        : {
            select: { id: true, runId: true },
            orderBy: { createdAt: "desc" },
            take: 1
          },
      rewritePlans: input.runId
        ? {
            where: { analysisRunId: input.runId },
            select: { id: true, analysisRunId: true },
            orderBy: { createdAt: "desc" },
            take: 1
          }
        : {
            select: { id: true, analysisRunId: true },
            orderBy: { createdAt: "desc" },
            take: 1
          },
      rewrites: {
        select: {
          id: true,
          chapterId: true,
          rewritePlanId: true,
          status: true
        }
      }
    }
  });
  const snapshot = recordFromUnknown(manuscript);
  const durableSnapshot: DurablePipelineSnapshot = {
    manuscript,
    profile: snapshot.profile,
    checkpoint: input.checkpoint,
    jobs: input.jobs
  };

  if (Array.isArray(snapshot.chapters)) {
    durableSnapshot.chapters = snapshot.chapters as DurablePipelineSnapshot["chapters"];
  }

  if (Array.isArray(snapshot.chunks)) {
    durableSnapshot.chunks = snapshot.chunks as DurablePipelineSnapshot["chunks"];
  }

  if (Array.isArray(snapshot.outputs)) {
    durableSnapshot.outputs = snapshot.outputs as DurablePipelineSnapshot["outputs"];
  }

  if (Array.isArray(snapshot.reports)) {
    durableSnapshot.reports = snapshot.reports as DurablePipelineSnapshot["reports"];
  }

  if (Array.isArray(snapshot.rewritePlans)) {
    durableSnapshot.rewritePlans =
      snapshot.rewritePlans as DurablePipelineSnapshot["rewritePlans"];
  }

  if (Array.isArray(snapshot.rewrites)) {
    durableSnapshot.chapterRewrites =
      snapshot.rewrites as DurablePipelineSnapshot["chapterRewrites"];
  }

  return evaluateDurablePipelineState(durableSnapshot);
}

export function evaluateDurablePipelineState(
  snapshot: DurablePipelineSnapshot
): DurablePipelineState {
  const checkpoint = normalizeCheckpoint(snapshot.checkpoint);
  const chapters = snapshot.chapters ?? [];
  const chunks = snapshot.chunks ?? [];
  const outputs = snapshot.outputs ?? [];
  const reports = snapshot.reports ?? [];
  const rewritePlans = snapshot.rewritePlans ?? [];
  const chapterRewrites = snapshot.chapterRewrites ?? [];
  const evaluationIncomplete =
    !Array.isArray(snapshot.chapters) ||
    !Array.isArray(snapshot.chunks) ||
    !Array.isArray(snapshot.outputs);
  const chunkOutputIds = outputScopeIds(outputs, AnalysisPassType.CHUNK_ANALYSIS);
  const chapterAuditOutputIds = outputScopeIds(
    outputs,
    AnalysisPassType.CHAPTER_AUDIT
  );
  const rewritePlan = rewritePlans[0] ?? null;
  const draftedChapterIds = new Set(
    chapterRewrites
      .filter((rewrite) => {
        if (rewritePlan?.id && rewrite.rewritePlanId !== rewritePlan.id) {
          return false;
        }

        return DONE_REWRITE_STATUSES.has(rewrite.status ?? "");
      })
      .map((rewrite) => rewrite.chapterId)
      .filter((id): id is string => Boolean(id))
  );
  const phases = [
    phase({
      phase: "parseAndNormalizeManuscript",
      total: 1,
      completed:
        Boolean(snapshot.manuscript?.originalText?.trim()) ||
        (snapshot.manuscript?.wordCount ?? 0) > 0
          ? 1
          : 0,
      inputDependency: "sourceText",
      expectedOutput: "Manuscript.originalText or word count",
      missingReason: "Stored source text is missing."
    }),
    phase({
      phase: "splitIntoChapters",
      total: 1,
      completed: chapters.length > 0 ? 1 : 0,
      inputDependency: "parseAndNormalizeManuscript",
      expectedOutput: "At least one ManuscriptChapter row",
      missingReason: "No manuscript chapters exist."
    }),
    phase({
      phase: "splitIntoChunks",
      total: 1,
      completed: chunks.length > 0 ? 1 : 0,
      inputDependency: "splitIntoChapters",
      expectedOutput: "At least one ManuscriptChunk row",
      missingReason: "No manuscript chunks exist."
    }),
    phase({
      phase: "createEmbeddingsForChunks",
      total: chunks.length,
      completed: chunks.filter(hasCompletedEmbeddingState).length,
      inputDependency: "splitIntoChunks",
      expectedOutput: "Each chunk has stored, empty, or skipped embedding state",
      missingReason: "Chunk embedding state is incomplete."
    }),
    phase({
      phase: "summarizeChunks",
      total: chunks.length,
      completed: chunks.filter(
        (chunk) => Boolean(chunk.summary?.trim()) || chunkOutputIds.has(chunk.id)
      ).length,
      inputDependency: "createEmbeddingsForChunks",
      expectedOutput:
        "Each chunk has current-run CHUNK_ANALYSIS output or persisted summary",
      missingReason: "Chunk summaries are incomplete."
    }),
    phase({
      phase: "summarizeChapters",
      total: chapters.length,
      completed: chapters.filter((chapter) => Boolean(chapter.summary?.trim()))
        .length,
      inputDependency: "summarizeChunks",
      expectedOutput: "Each chapter has a persisted summary",
      missingReason: "Chapter summaries are incomplete."
    }),
    phase({
      phase: "createManuscriptProfile",
      total: 1,
      completed: snapshot.profile ? 1 : 0,
      inputDependency: "summarizeChapters",
      expectedOutput: "ManuscriptProfile row",
      missingReason: "Manuscript profile is missing."
    }),
    phase({
      phase: "runChapterAudits",
      total: chapters.length,
      completed: chapters.filter((chapter) => chapterAuditOutputIds.has(chapter.id))
        .length,
      inputDependency: "createManuscriptProfile",
      expectedOutput: "Each chapter has current-run CHAPTER_AUDIT output",
      missingReason: "Chapter audit outputs are incomplete."
    }),
    phase({
      phase: "runWholeBookAudit",
      total: 1,
      completed: reports.length > 0 ? 1 : 0,
      inputDependency: "runChapterAudits",
      expectedOutput: "AuditReport for the current run",
      missingReason: "Whole-book audit report is missing."
    }),
    phase({
      phase: "compareAgainstCorpus",
      total: 1,
      completed: hasOutput(outputs, AnalysisPassType.CORPUS_COMPARISON) ? 1 : 0,
      inputDependency: "runWholeBookAudit",
      expectedOutput: "Current-run CORPUS_COMPARISON output, including skipped output",
      missingReason: "Corpus comparison output is missing."
    }),
    phase({
      phase: "compareAgainstTrendSignals",
      total: 1,
      completed: hasOutput(outputs, AnalysisPassType.TREND_COMPARISON) ? 1 : 0,
      inputDependency: "compareAgainstCorpus",
      expectedOutput: "Current-run TREND_COMPARISON output, including skipped output",
      missingReason: "Trend comparison output is missing."
    }),
    phase({
      phase: "createRewritePlan",
      total: 1,
      completed: rewritePlan ? 1 : 0,
      inputDependency: "compareAgainstTrendSignals",
      expectedOutput: "RewritePlan for the current run",
      missingReason: "Rewrite plan is missing."
    }),
    phase({
      phase: "generateChapterRewriteDrafts",
      total: chapters.length,
      completed: chapters.filter((chapter) => draftedChapterIds.has(chapter.id))
        .length,
      inputDependency: "createRewritePlan",
      expectedOutput: "Draft or accepted ChapterRewrite for each chapter",
      missingReason: "Chapter rewrite drafts are incomplete."
    })
  ];
  const phaseByStep = Object.fromEntries(
    phases.map((candidate) => [candidate.phase, candidate])
  ) as Record<ManuscriptPipelineStep, DurablePhaseState>;
  const completedSteps = sequentialCompletedSteps(phases);
  const currentPhase =
    CORE_MANUSCRIPT_PIPELINE_STEPS.find(
      (step) => !completedSteps.includes(step)
    ) ?? null;
  const currentPhaseState = currentPhase ? phaseByStep[currentPhase] : null;
  const checkpointPhase = phaseFromCheckpoint(checkpoint);
  const jobStatusPhase = phaseFromJobs(snapshot.jobs ?? []);
  const reconciledCheckpoint = checkpointFromDurableState(
    checkpoint,
    completedSteps,
    currentPhaseState
  );
  const checkpointChanged = !checkpointsMatch(checkpoint, reconciledCheckpoint);
  const mismatchWarnings = mismatchWarningsForState({
    checkpoint,
    completedSteps,
    currentPhase,
    phases,
    jobs: snapshot.jobs ?? []
  });
  const staleMetadataDetected = checkpointChanged || mismatchWarnings.length > 0;

  return {
    phases,
    phaseByStep,
    completedSteps,
    currentPhase,
    currentPhaseState,
    nextJobType: currentPhaseState?.phase ?? null,
    checkpointPhase,
    jobStatusPhase,
    reconciledCheckpoint,
    checkpointChanged,
    staleMetadataDetected,
    mismatchWarnings,
    recoverable: Boolean(currentPhaseState),
    complete: completedSteps.length === CORE_MANUSCRIPT_PIPELINE_STEPS.length,
    evaluationIncomplete
  };
}

export function durableProgressMetadata(phase: DurablePhaseState) {
  return {
    total: phase.total,
    completed: phase.completed,
    remaining: phase.remaining,
    complete: phase.isComplete,
    blockingReason: phase.blockingReason
  };
}

export function stepIndex(step: unknown) {
  return typeof step === "string"
    ? MANUSCRIPT_PIPELINE_STEPS.indexOf(step as ManuscriptPipelineStep)
    : -1;
}

function phase(input: {
  phase: ManuscriptPipelineStep;
  total: number;
  completed: number;
  inputDependency: DurablePhaseState["inputDependency"];
  expectedOutput: string;
  missingReason: string;
}): DurablePhaseState {
  const total = Math.max(0, input.total);
  const completed = Math.min(Math.max(0, input.completed), total);
  const remaining = Math.max(total - completed, 0);
  const isComplete = total > 0 && remaining === 0;

  return {
    phase: input.phase,
    total,
    completed,
    remaining,
    isComplete,
    blockingReason: isComplete ? null : input.missingReason,
    recoverable: !isComplete,
    nextJobType: isComplete ? nextStep(input.phase) : input.phase,
    inputDependency: input.inputDependency,
    expectedOutput: input.expectedOutput
  };
}

function sequentialCompletedSteps(phases: DurablePhaseState[]) {
  const completed: ManuscriptPipelineStep[] = [];

  for (const step of CORE_MANUSCRIPT_PIPELINE_STEPS) {
    const state = phases.find((candidate) => candidate.phase === step);
    if (!state?.isComplete) {
      break;
    }
    completed.push(step);
  }

  return completed;
}

function checkpointFromDurableState(
  checkpoint: PipelineCheckpoint,
  completedSteps: ManuscriptPipelineStep[],
  currentPhase: DurablePhaseState | null
): PipelineCheckpoint {
  const metadata = { ...(checkpoint.stepMetadata ?? {}) };
  if (currentPhase) {
    metadata[currentPhase.phase] = {
      ...recordFromUnknown(metadata[currentPhase.phase]),
      ...durableProgressMetadata(currentPhase)
    };
  }

  return {
    ...checkpoint,
    currentStep: currentPhase?.phase,
    completedSteps,
    stepMetadata: metadata
  };
}

function phaseFromCheckpoint(checkpoint: PipelineCheckpoint) {
  if (isManuscriptPipelineStep(checkpoint.currentStep)) {
    return checkpoint.currentStep;
  }

  const completed = new Set(
    (checkpoint.completedSteps ?? []).filter(isManuscriptPipelineStep)
  );

  return (
    CORE_MANUSCRIPT_PIPELINE_STEPS.find((step) => !completed.has(step)) ?? null
  );
}

function phaseFromJobs(jobs: DurablePipelineJobSnapshot[]) {
  const job = [...jobs]
    .filter(
      (candidate) =>
        isManuscriptPipelineStep(candidate.type) &&
        ACTIVE_JOB_STATUSES.has(candidate.status)
    )
    .sort((left, right) => stepIndex(left.type) - stepIndex(right.type))[0];

  return job?.type ?? null;
}

function mismatchWarningsForState(input: {
  checkpoint: PipelineCheckpoint;
  completedSteps: ManuscriptPipelineStep[];
  currentPhase: ManuscriptPipelineStep | null;
  phases: DurablePhaseState[];
  jobs: DurablePipelineJobSnapshot[];
}) {
  const warnings: string[] = [];
  const durableCompleted = new Set(input.completedSteps);

  for (const step of input.checkpoint.completedSteps ?? []) {
    if (isManuscriptPipelineStep(step) && !durableCompleted.has(step)) {
      warnings.push(
        `${step} is marked complete in checkpoint but durable outputs are incomplete.`
      );
    }
  }

  const checkpointPhase = phaseFromCheckpoint(input.checkpoint);
  if (checkpointPhase !== input.currentPhase) {
    warnings.push(
      `Checkpoint phase ${checkpointPhase ?? "complete"} does not match durable phase ${
        input.currentPhase ?? "complete"
      }.`
    );
  }

  for (const job of input.jobs) {
    if (!isManuscriptPipelineStep(job.type)) {
      continue;
    }

    const phaseState = input.phases.find((phase) => phase.phase === job.type);
    if (
      job.status === PIPELINE_JOB_STATUS.COMPLETED &&
      phaseState &&
      !durableCompleted.has(phaseState.phase)
    ) {
      warnings.push(
        `${job.type} job is completed but durable outputs are incomplete.`
      );
    }
  }

  return Array.from(new Set(warnings));
}

function outputScopeIds(
  outputs: NonNullable<DurablePipelineSnapshot["outputs"]>,
  passType: string
) {
  return new Set(
    outputs
      .filter((output) => output.passType === passType)
      .filter(
        (output) =>
          (output.status ?? COMPLETED_OUTPUT_STATUS) === COMPLETED_OUTPUT_STATUS
      )
      .map((output) => output.scopeId ?? scopeIdFromOutput(output.output))
      .filter((id): id is string => Boolean(id))
  );
}

function hasOutput(
  outputs: NonNullable<DurablePipelineSnapshot["outputs"]>,
  passType: string
) {
  return outputs.some(
    (output) =>
      output.passType === passType &&
      (output.status ?? COMPLETED_OUTPUT_STATUS) === COMPLETED_OUTPUT_STATUS
  );
}

function hasCompletedEmbeddingState(chunk: { localMetrics?: unknown }) {
  const status = recordFromUnknown(chunk.localMetrics).embeddingStatus;
  return typeof status === "string" && DONE_EMBEDDING_STATUSES.has(status);
}

function scopeIdFromOutput(value: unknown) {
  const record = recordFromUnknown(value);
  return typeof record.scopeId === "string" ? record.scopeId : null;
}

function nextStep(step: ManuscriptPipelineStep): ManuscriptPipelineStep | null {
  const index = stepIndex(step);
  return index >= 0 ? MANUSCRIPT_PIPELINE_STEPS[index + 1] ?? null : null;
}

function checkpointsMatch(left: PipelineCheckpoint, right: PipelineCheckpoint) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
