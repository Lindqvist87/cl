import { AnalysisRunStatus, type Prisma } from "@prisma/client";
import { importSignatureFromManifest } from "@/lib/import/v2/manifest";
import type { ImportManifest } from "@/lib/import/v2/types";
import { jsonInput } from "@/lib/json";

export type ImportInvalidationPlan = {
  changed: boolean;
  previousSignature: string | null;
  nextSignature: string;
  reasons: string[];
};

export function buildImportInvalidationPlan(input: {
  previousSignature?: string | null;
  manifest: ImportManifest;
}): ImportInvalidationPlan {
  const nextSignature = importSignatureFromManifest(input.manifest);
  const previousSignature = input.previousSignature ?? null;

  if (!previousSignature) {
    return {
      changed: true,
      previousSignature,
      nextSignature,
      reasons: ["missing_previous_import_signature"]
    };
  }

  if (previousSignature === nextSignature) {
    return {
      changed: false,
      previousSignature,
      nextSignature,
      reasons: []
    };
  }

  return {
    changed: true,
    previousSignature,
    nextSignature,
    reasons: ["parser_source_or_structure_changed"]
  };
}

export async function invalidateImportDerivedArtifacts(
  tx: Prisma.TransactionClient,
  input: {
    manuscriptId: string;
    plan: ImportInvalidationPlan;
    keepAnalysisRunId?: string;
    resetPipelineJobs?: boolean;
  }
) {
  if (!input.plan.changed) {
    return { invalidated: false };
  }

  const manuscriptId = input.manuscriptId;

  await tx.compilerArtifact.deleteMany({ where: { manuscriptId } });
  await tx.manuscriptNode.deleteMany({ where: { manuscriptId } });
  await tx.narrativeFact.deleteMany({ where: { manuscriptId } });
  await tx.characterState.deleteMany({ where: { manuscriptId } });
  await tx.plotEvent.deleteMany({ where: { manuscriptId } });
  await tx.styleFingerprint.deleteMany({ where: { manuscriptId } });
  await tx.analysisOutput.deleteMany({ where: { manuscriptId } });
  await tx.finding.deleteMany({ where: { manuscriptId } });
  await tx.manuscriptProfile.deleteMany({ where: { manuscriptId } });
  await tx.auditReport.deleteMany({ where: { manuscriptId } });
  await tx.rewritePlan.deleteMany({ where: { manuscriptId } });
  await tx.chapterRewrite.deleteMany({ where: { manuscriptId } });

  if (input.resetPipelineJobs) {
    await tx.pipelineJob.deleteMany({
      where: {
        manuscriptId,
        type: { not: "parseAndNormalizeManuscript" }
      }
    });
    await tx.pipelineJob.updateMany({
      where: { manuscriptId, type: "parseAndNormalizeManuscript" },
      data: {
        status: "COMPLETED",
        error: null,
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
        completedAt: new Date()
      }
    });
  }

  await tx.analysisRun.updateMany({
    where: input.keepAnalysisRunId
      ? { manuscriptId, id: { not: input.keepAnalysisRunId } }
      : { manuscriptId },
    data: {
      status: AnalysisRunStatus.QUEUED,
      checkpoint: jsonInput({
        completedSteps: ["parseAndNormalizeManuscript"],
        invalidatedAt: new Date().toISOString(),
        importSignature: input.plan.nextSignature,
        invalidationReasons: input.plan.reasons
      }),
      completedAt: null,
      error: null
    }
  });

  return {
    invalidated: true,
    reasons: input.plan.reasons
  };
}
