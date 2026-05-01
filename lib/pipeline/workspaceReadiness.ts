import { AnalysisPassType } from "@prisma/client";
import { dependencyIdsFromJson, PIPELINE_JOB_STATUS } from "@/lib/pipeline/jobRules";
import {
  FULL_MANUSCRIPT_PIPELINE_STEPS,
  normalizeCheckpoint
} from "@/lib/pipeline/steps";
import { prisma } from "@/lib/prisma";

export type WorkspaceArtifactState =
  | "available"
  | "skipped"
  | "empty"
  | "missing";

export type WorkspacePipelineState =
  | "pipeline_still_running"
  | "completed_without_whole_book_output"
  | "completed_with_usable_output"
  | "failed_with_actionable_error";

export type WorkspaceReadinessContract = {
  parsedManuscriptData: boolean;
  sectionsDetected: boolean;
  chunksCreated: boolean;
  chunkSummaries: WorkspaceArtifactState;
  chapterSummaries: WorkspaceArtifactState;
  manuscriptProfile: WorkspaceArtifactState;
  chapterAudits: WorkspaceArtifactState;
  wholeBookAudit: WorkspaceArtifactState;
  corpusComparison: WorkspaceArtifactState;
  trendComparison: WorkspaceArtifactState;
  rewritePlan: WorkspaceArtifactState;
  completedSteps: string[];
  missingSteps: string[];
  blockedJobsWithCompleteDependencies: number;
  failedJobs: number;
  failedJobsWithoutError: number;
};

export type WorkspaceReadinessSummary = {
  state: WorkspacePipelineState;
  workspaceReady: boolean;
  usableWholeBookOutput: boolean;
  actionableError: string | null;
  contract: WorkspaceReadinessContract;
};

type ReadinessOutput = {
  passType: string;
  scopeId?: string | null;
  output?: unknown;
  rawText?: string | null;
};

type ReadinessJob = {
  id: string;
  type: string;
  status: string;
  dependencyIds?: unknown;
  error?: string | null;
};

export type WorkspaceReadinessSnapshot = {
  manuscript: {
    id: string;
    originalText?: string | null;
    wordCount?: number | null;
    analysisStatus?: string | null;
    status?: string | null;
  };
  chapters: Array<{
    id: string;
    summary?: string | null;
    text?: string | null;
    wordCount?: number | null;
  }>;
  chunks: Array<{
    id: string;
    summary?: string | null;
    text?: string | null;
    wordCount?: number | null;
    localMetrics?: unknown;
  }>;
  outputs: ReadinessOutput[];
  profile?: unknown | null;
  rewritePlans: unknown[];
  jobs: ReadinessJob[];
  checkpoint?: unknown;
  globalSummary?: string | null;
};

const WHOLE_BOOK_PASS = AnalysisPassType.WHOLE_BOOK_AUDIT;

export async function getWorkspaceReadinessForManuscript(
  manuscriptId: string
): Promise<WorkspaceReadinessSummary> {
  const manuscript = await prisma.manuscript.findUnique({
    where: { id: manuscriptId },
    include: {
      chapters: { select: { id: true, summary: true, text: true, wordCount: true } },
      chunks: {
        select: {
          id: true,
          summary: true,
          text: true,
          wordCount: true,
          localMetrics: true
        }
      },
      profile: true,
      outputs: {
        select: {
          passType: true,
          scopeId: true,
          output: true,
          rawText: true
        }
      },
      reports: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { executiveSummary: true }
      },
      rewritePlans: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true }
      },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { checkpoint: true }
      },
      pipelineJobs: {
        select: {
          id: true,
          type: true,
          status: true,
          dependencyIds: true,
          error: true
        }
      }
    }
  });

  if (!manuscript) {
    throw new Error("Manuscript not found.");
  }

  return evaluateWorkspaceReadiness({
    manuscript,
    chapters: manuscript.chapters,
    chunks: manuscript.chunks,
    outputs: manuscript.outputs,
    profile: manuscript.profile,
    rewritePlans: manuscript.rewritePlans,
    jobs: manuscript.pipelineJobs,
    checkpoint: manuscript.runs[0]?.checkpoint,
    globalSummary: manuscript.reports[0]?.executiveSummary ?? null
  });
}

export function evaluateWorkspaceReadiness(
  snapshot: WorkspaceReadinessSnapshot
): WorkspaceReadinessSummary {
  const checkpoint = normalizeCheckpoint(snapshot.checkpoint);
  const completedSteps = (checkpoint.completedSteps ?? []).filter((step) =>
    FULL_MANUSCRIPT_PIPELINE_STEPS.includes(
      step as (typeof FULL_MANUSCRIPT_PIPELINE_STEPS)[number]
    )
  );
  const completedStepSet = new Set(completedSteps);
  const missingSteps = FULL_MANUSCRIPT_PIPELINE_STEPS.filter(
    (step) => !completedStepSet.has(step)
  );
  const wholeBookOutput = outputForPass(snapshot.outputs, WHOLE_BOOK_PASS);
  const usableWholeBookOutput =
    outputState([wholeBookOutput]) === "available" ||
    Boolean(snapshot.globalSummary?.trim());
  const failedJobs = snapshot.jobs.filter(
    (job) => job.status === PIPELINE_JOB_STATUS.FAILED
  );
  const contract: WorkspaceReadinessContract = {
    parsedManuscriptData: Boolean(
      snapshot.manuscript.originalText?.trim() ||
        (snapshot.manuscript.wordCount ?? 0) > 0
    ),
    sectionsDetected: snapshot.chapters.length > 0,
    chunksCreated: snapshot.chunks.length > 0,
    chunkSummaries: collectionState({
      total: snapshot.chunks.length,
      available: countChunksWithSummary(snapshot),
      skipped: countSkippedChunks(snapshot)
    }),
    chapterSummaries: collectionState({
      total: snapshot.chapters.length,
      available: snapshot.chapters.filter((chapter) => chapter.summary?.trim())
        .length
    }),
    manuscriptProfile: snapshot.profile ? "available" : "missing",
    chapterAudits: collectionState({
      total: snapshot.chapters.length,
      available: outputsForPass(snapshot.outputs, AnalysisPassType.CHAPTER_AUDIT)
        .filter((output) => !isSkippedOutput(output.output))
        .length,
      skipped: outputsForPass(snapshot.outputs, AnalysisPassType.CHAPTER_AUDIT)
        .filter((output) => isSkippedOutput(output.output))
        .length
    }),
    wholeBookAudit: outputState([wholeBookOutput]),
    corpusComparison: outputState([
      outputForPass(snapshot.outputs, AnalysisPassType.CORPUS_COMPARISON)
    ]),
    trendComparison: outputState([
      outputForPass(snapshot.outputs, AnalysisPassType.TREND_COMPARISON)
    ]),
    rewritePlan: snapshot.rewritePlans.length > 0 ? "available" : "missing",
    completedSteps,
    missingSteps,
    blockedJobsWithCompleteDependencies:
      countBlockedJobsWithCompleteDependencies(snapshot.jobs),
    failedJobs: failedJobs.length,
    failedJobsWithoutError: failedJobs.filter((job) => !job.error?.trim()).length
  };
  const analysisStatus = snapshot.manuscript.analysisStatus ?? "NOT_STARTED";
  const actionableError =
    failedJobs[0]?.error ??
    (analysisStatus === "FAILED" ? "Pipeline failed. Review failed jobs." : null);
  const state = determineWorkspacePipelineState({
    analysisStatus,
    failedJobs: contract.failedJobs,
    missingSteps: contract.missingSteps.length,
    usableWholeBookOutput,
    rewritePlanAvailable: contract.rewritePlan === "available",
    actionableError
  });

  return {
    state,
    workspaceReady: state === "completed_with_usable_output",
    usableWholeBookOutput,
    actionableError,
    contract
  };
}

export function determineWorkspacePipelineState(input: {
  analysisStatus?: string | null;
  failedJobs?: number;
  missingSteps?: number;
  usableWholeBookOutput: boolean;
  rewritePlanAvailable: boolean;
  actionableError?: string | null;
}): WorkspacePipelineState {
  if (
    input.analysisStatus === "FAILED" ||
    (input.failedJobs ?? 0) > 0 ||
    Boolean(input.actionableError)
  ) {
    return "failed_with_actionable_error";
  }

  if (input.analysisStatus !== "COMPLETED" || (input.missingSteps ?? 0) > 0) {
    return "pipeline_still_running";
  }

  if (!input.usableWholeBookOutput) {
    return "completed_without_whole_book_output";
  }

  return input.rewritePlanAvailable
    ? "completed_with_usable_output"
    : "completed_without_whole_book_output";
}

function outputState(outputs: Array<ReadinessOutput | undefined>): WorkspaceArtifactState {
  const present = outputs.filter((output): output is ReadinessOutput =>
    Boolean(output)
  );

  if (present.length === 0) {
    return "missing";
  }

  if (present.every((output) => isSkippedOutput(output.output))) {
    return "skipped";
  }

  return present.some((output) => hasUsableOutput(output.output, output.rawText))
    ? "available"
    : "empty";
}

function collectionState(input: {
  total: number;
  available: number;
  skipped?: number;
}): WorkspaceArtifactState {
  if (input.total === 0) {
    return "empty";
  }

  if (input.available > 0) {
    return input.available >= input.total ? "available" : "available";
  }

  if ((input.skipped ?? 0) >= input.total) {
    return "skipped";
  }

  return "missing";
}

function countChunksWithSummary(snapshot: WorkspaceReadinessSnapshot) {
  const outputIds = new Set(
    outputsForPass(snapshot.outputs, AnalysisPassType.CHUNK_ANALYSIS)
      .filter((output) => !isSkippedOutput(output.output))
      .map((output) => output.scopeId ?? scopeIdFromOutput(output.output))
      .filter(Boolean)
  );

  return snapshot.chunks.filter(
    (chunk) => chunk.summary?.trim() || outputIds.has(chunk.id)
  ).length;
}

function countSkippedChunks(snapshot: WorkspaceReadinessSnapshot) {
  const skippedIds = new Set(
    outputsForPass(snapshot.outputs, AnalysisPassType.CHUNK_ANALYSIS)
      .filter((output) => isSkippedOutput(output.output))
      .map((output) => output.scopeId ?? scopeIdFromOutput(output.output))
      .filter(Boolean)
  );

  return snapshot.chunks.filter((chunk) => skippedIds.has(chunk.id)).length;
}

function outputForPass(outputs: ReadinessOutput[], passType: AnalysisPassType) {
  return outputs.find((output) => output.passType === passType);
}

function outputsForPass(outputs: ReadinessOutput[], passType: AnalysisPassType) {
  return outputs.filter((output) => output.passType === passType);
}

function isSkippedOutput(value: unknown) {
  const record = toRecord(value);

  return record.status === "skipped" || record.skipped === true;
}

function hasUsableOutput(value: unknown, rawText?: string | null) {
  if (isSkippedOutput(value)) {
    return false;
  }

  const record = toRecord(value);
  if (Object.keys(record).length > 0) {
    return true;
  }

  return Boolean(rawText?.trim());
}

function scopeIdFromOutput(value: unknown) {
  const record = toRecord(value);
  return typeof record.scopeId === "string" ? record.scopeId : null;
}

function countBlockedJobsWithCompleteDependencies(jobs: ReadinessJob[]) {
  const completedIds = new Set(
    jobs
      .filter((job) => job.status === PIPELINE_JOB_STATUS.COMPLETED)
      .map((job) => job.id)
  );

  return jobs.filter((job) => {
    if (job.status !== PIPELINE_JOB_STATUS.BLOCKED) {
      return false;
    }

    const dependencyIds = dependencyIdsFromJson(job.dependencyIds);
    return (
      dependencyIds.length > 0 &&
      dependencyIds.every((dependencyId) => completedIds.has(dependencyId))
    );
  }).length;
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
