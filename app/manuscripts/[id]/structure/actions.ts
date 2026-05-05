"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  buildImportInvalidationPlan,
  invalidateImportDerivedArtifacts
} from "@/lib/import/v2/invalidation";
import {
  importManifestFromMetadata,
  importSignatureFromMetadata,
  metadataWithImportManifest,
  recordFromUnknown
} from "@/lib/import/v2/manifest";
import {
  applyImportReviewAction,
  type ImportReviewAction
} from "@/lib/import/v2/review";
import type { ImportHeadingType } from "@/lib/import/v2/types";
import { jsonInput } from "@/lib/json";
import { prisma } from "@/lib/prisma";

export async function approveImportStructure(formData: FormData) {
  await applyStructureAction(formData, { type: "approve" });
}

export async function renameImportSection(formData: FormData) {
  const blockId = requiredString(formData, "blockId");
  const title = requiredString(formData, "title");
  const chapterId = stringField(formData, "chapterId");

  if (chapterId) {
    await prisma.manuscriptChapter.update({
      where: { id: chapterId },
      data: { title, heading: title }
    });
  }

  await applyStructureAction(formData, { type: "rename", blockId, title });
}

export async function reclassifyImportSection(formData: FormData) {
  await applyStructureAction(formData, {
    type: "reclassify",
    blockId: requiredString(formData, "blockId"),
    headingType: headingTypeField(formData, "headingType")
  });
}

export async function splitImportSection(formData: FormData) {
  await applyStructureAction(formData, {
    type: "split",
    blockId: requiredString(formData, "blockId"),
    atBlockId: requiredString(formData, "targetBlockId")
  });
}

export async function mergeImportSection(formData: FormData) {
  await applyStructureAction(formData, {
    type: "merge",
    blockId: requiredString(formData, "blockId"),
    targetBlockId: requiredString(formData, "targetBlockId")
  });
}

async function applyStructureAction(
  formData: FormData,
  action: ImportReviewAction
) {
  const manuscriptId = requiredString(formData, "manuscriptId");
  const manuscript = await prisma.manuscript.findUniqueOrThrow({
    where: { id: manuscriptId },
    select: { metadata: true }
  });
  const metadata = recordFromUnknown(manuscript.metadata);
  const manifest = importManifestFromMetadata(metadata);

  if (!manifest) {
    throw new Error("This manuscript has no import v2 manifest to review.");
  }

  const nextManifest = applyImportReviewAction(manifest, action);
  const plan = buildImportInvalidationPlan({
    previousSignature: importSignatureFromMetadata(metadata),
    manifest: nextManifest
  });

  const pendingInvalidation = action.type !== "approve" && plan.changed;

  await prisma.$transaction(async (tx) => {
    if (pendingInvalidation) {
      await invalidateImportDerivedArtifacts(tx, {
        manuscriptId,
        plan,
        resetPipelineJobs: true
      });
    }

    await tx.manuscript.update({
      where: { id: manuscriptId },
      data: {
        status: "IMPORT_REVIEWED",
        metadata: jsonInput(
          metadataWithImportManifest(
            {
              ...metadata,
              importReview: {
                lastAction: action.type,
                pendingInvalidation,
                invalidationReasons: plan.reasons,
                updatedAt: new Date().toISOString()
              },
              structureReview: {
                ...recordFromUnknown(metadata.structureReview),
                recommended: pendingInvalidation,
                approvedAt:
                  action.type === "approve"
                    ? new Date().toISOString()
                    : recordFromUnknown(metadata.structureReview).approvedAt
              }
            },
            nextManifest
          )
        )
      }
    });
  });

  revalidatePath(`/manuscripts/${manuscriptId}`);
  revalidatePath(`/manuscripts/${manuscriptId}/structure`);
  redirect(`/manuscripts/${manuscriptId}/structure`);
}

function requiredString(formData: FormData, name: string) {
  const value = stringField(formData, name);
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }

  return value;
}

function stringField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function headingTypeField(formData: FormData, name: string): ImportHeadingType {
  const value = stringField(formData, name);
  if (
    value === "front_matter" ||
    value === "part" ||
    value === "chapter" ||
    value === "scene" ||
    value === "section" ||
    value === "unknown"
  ) {
    return value;
  }

  return "section";
}
