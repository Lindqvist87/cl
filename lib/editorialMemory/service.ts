import { prisma } from "../prisma";
import { hashJson } from "../compiler/hash";
import {
  extractRawEditorialMemoryItems,
  normalizeEditorialMemoryItems
} from "./normalization";
import { planAnchorStaleUpdates, type ExistingEditorialMemoryAnchor } from "./stale";
import type {
  EditorialMemoryAnchorChange,
  EditorialMemoryStaleResult,
  EditorialMemoryUpsertInput,
  EditorialMemoryUpsertResult
} from "./types";

type EditorialMemoryDb = {
  editorialMemoryItem: Record<string, any>;
  editorialMemorySource: Record<string, any>;
  editorialMemoryAnchor: Record<string, any>;
  editorialMemoryRevision: Record<string, any>;
};

export async function upsertEditorialMemoryItemsFromRawOutput(
  input: EditorialMemoryUpsertInput,
  db: EditorialMemoryDb = prisma as EditorialMemoryDb
): Promise<EditorialMemoryUpsertResult> {
  const rawItems = input.items ?? extractRawEditorialMemoryItems(input.rawOutput);
  const items = normalizeEditorialMemoryItems(rawItems);
  const rawOutputHash = hashJson(input.rawOutput);
  const result: EditorialMemoryUpsertResult = {
    upserted: 0,
    created: 0,
    updated: 0,
    sourceRows: 0,
    anchorRows: 0,
    revisionRows: 0,
    itemKeys: []
  };

  for (const item of items) {
    const existing = await db.editorialMemoryItem.findUnique({
      where: {
        manuscriptId_key: {
          manuscriptId: input.manuscriptId,
          key: item.key
        }
      }
    });
    const previousValue = existing
      ? {
          title: existing.title,
          content: existing.content,
          confidence: existing.confidence,
          status: existing.status
        }
      : null;
    const row = await db.editorialMemoryItem.upsert({
      where: {
        manuscriptId_key: {
          manuscriptId: input.manuscriptId,
          key: item.key
        }
      },
      create: {
        manuscriptId: input.manuscriptId,
        key: item.key,
        type: item.type,
        title: item.title,
        content: item.content,
        confidence: item.confidence,
        status: "ACTIVE",
        metadata: item.metadata
      },
      update: {
        type: item.type,
        title: item.title,
        content: item.content,
        confidence: item.confidence,
        status: "ACTIVE",
        supersededById: null,
        metadata: item.metadata
      }
    });

    await db.editorialMemorySource.create({
      data: {
        itemId: row.id,
        manuscriptId: input.manuscriptId,
        analysisRunId: input.analysisRunId ?? null,
        analysisOutputId: input.analysisOutputId ?? null,
        snapshotId: input.snapshotId ?? null,
        sourceType: input.source?.sourceType ?? "raw_output",
        sourceId: input.source?.sourceId ?? null,
        promptVersion: input.source?.promptVersion ?? null,
        model: input.source?.model ?? null,
        rawOutputHash,
        rawOutput: input.rawOutput,
        provenance: input.source?.provenance ?? null
      }
    });

    await db.editorialMemoryAnchor.deleteMany({
      where: { itemId: row.id }
    });

    if (item.anchors.length > 0) {
      await db.editorialMemoryAnchor.createMany({
        data: item.anchors.map((anchor) => ({
          itemId: row.id,
          manuscriptId: input.manuscriptId,
          nodeId: anchor.nodeId ?? null,
          chapterId: anchor.chapterId ?? null,
          sceneId: anchor.sceneId ?? null,
          chunkId: anchor.chunkId ?? null,
          paragraphStart: anchor.paragraphStart ?? null,
          paragraphEnd: anchor.paragraphEnd ?? null,
          startOffset: anchor.startOffset ?? null,
          endOffset: anchor.endOffset ?? null,
          textHash: anchor.textHash ?? null,
          revision: anchor.revision ?? null,
          sourceTextSnippet: anchor.sourceTextSnippet ?? null,
          status: "ACTIVE",
          metadata: anchor.metadata ?? null
        }))
      });
    }

    await db.editorialMemoryRevision.create({
      data: {
        itemId: row.id,
        manuscriptId: input.manuscriptId,
        analysisRunId: input.analysisRunId ?? null,
        snapshotId: input.snapshotId ?? null,
        fromStatus: previousValue?.status ?? null,
        toStatus: "ACTIVE",
        reason: existing ? "Memory item refreshed from raw output." : "Memory item created from raw output.",
        previousValue,
        nextValue: {
          title: item.title,
          content: item.content,
          confidence: item.confidence,
          status: "ACTIVE"
        },
        metadata: {
          rawOutputHash,
          sourceType: input.source?.sourceType ?? "raw_output"
        }
      }
    });

    result.upserted += 1;
    result.created += existing ? 0 : 1;
    result.updated += existing ? 1 : 0;
    result.sourceRows += 1;
    result.anchorRows += item.anchors.length;
    result.revisionRows += 1;
    result.itemKeys.push(item.key);
  }

  return result;
}

export async function markEditorialMemoryForAnchorChanges(
  manuscriptId: string,
  changes: EditorialMemoryAnchorChange[],
  db: EditorialMemoryDb = prisma as EditorialMemoryDb
): Promise<EditorialMemoryStaleResult> {
  if (changes.length === 0) {
    return emptyStaleResult();
  }

  const scopedWhere = buildAnchorChangeWhere(changes);
  if (scopedWhere.length === 0) {
    return emptyStaleResult();
  }

  const anchors = (await db.editorialMemoryAnchor.findMany({
    where: {
      manuscriptId,
      status: "ACTIVE",
      OR: scopedWhere
    }
  })) as ExistingEditorialMemoryAnchor[];
  const plan = planAnchorStaleUpdates(anchors, changes);
  const byStatus = groupPlanByStatus(plan);
  const affectedItemStatus = strongestStatusByItem(plan);
  const result = emptyStaleResult();

  for (const [status, entries] of Object.entries(byStatus)) {
    if (entries.length === 0) {
      continue;
    }

    await db.editorialMemoryAnchor.updateMany({
      where: { id: { in: entries.map((entry) => entry.anchorId) } },
      data: { status }
    });

    if (status === "STALE") {
      result.staleAnchors += entries.length;
    } else {
      result.needsReanchorAnchors += entries.length;
    }
  }

  for (const [itemId, status] of affectedItemStatus) {
    const item = await db.editorialMemoryItem.findUnique({
      where: { id: itemId }
    });
    if (!item || item.status === "SUPERSEDED" || item.status === status) {
      continue;
    }

    await db.editorialMemoryItem.update({
      where: { id: itemId },
      data: { status }
    });
    await db.editorialMemoryRevision.create({
      data: {
        itemId,
        manuscriptId,
        fromStatus: item.status,
        toStatus: status,
        reason: status === "STALE"
          ? "Memory anchor revision changed."
          : "Memory anchor text hash changed.",
        previousValue: { status: item.status },
        nextValue: { status },
        metadata: {
          anchorChangeReasons: plan
            .filter((entry) => entry.itemId === itemId)
            .map((entry) => entry.reason)
        }
      }
    });

    result.revisionRows += 1;
    if (status === "STALE") {
      result.staleItems += 1;
    } else {
      result.needsReanchorItems += 1;
    }
  }

  return result;
}

export async function markEditorialMemoryStaleForRevisionChange(
  manuscriptId: string,
  changes: EditorialMemoryAnchorChange[],
  db: EditorialMemoryDb = prisma as EditorialMemoryDb
) {
  return markEditorialMemoryForAnchorChanges(manuscriptId, changes, db);
}

export async function markEditorialMemoryNeedsReanchorForTextHashChange(
  manuscriptId: string,
  changes: EditorialMemoryAnchorChange[],
  db: EditorialMemoryDb = prisma as EditorialMemoryDb
) {
  return markEditorialMemoryForAnchorChanges(manuscriptId, changes, db);
}

function buildAnchorChangeWhere(changes: EditorialMemoryAnchorChange[]) {
  if (
    changes.some(
      (change) =>
        change.nodeId == null &&
        change.chunkId == null &&
        change.sceneId == null &&
        change.chapterId == null
    )
  ) {
    return [{}];
  }

  return changes.flatMap((change) => {
    const scopes = [];
    if (change.nodeId != null) scopes.push({ nodeId: change.nodeId });
    if (change.chunkId != null) scopes.push({ chunkId: change.chunkId });
    if (change.sceneId != null) scopes.push({ sceneId: change.sceneId });
    if (change.chapterId != null) scopes.push({ chapterId: change.chapterId });
    return scopes;
  });
}

function groupPlanByStatus(plan: ReturnType<typeof planAnchorStaleUpdates>) {
  return {
    STALE: plan.filter((entry) => entry.status === "STALE"),
    NEEDS_REANCHOR: plan.filter((entry) => entry.status === "NEEDS_REANCHOR")
  };
}

function strongestStatusByItem(plan: ReturnType<typeof planAnchorStaleUpdates>) {
  const statuses = new Map<string, "STALE" | "NEEDS_REANCHOR">();
  for (const entry of plan) {
    const existing = statuses.get(entry.itemId);
    if (existing === "NEEDS_REANCHOR") {
      continue;
    }
    statuses.set(entry.itemId, entry.status);
  }
  return statuses;
}

function emptyStaleResult(): EditorialMemoryStaleResult {
  return {
    staleItems: 0,
    needsReanchorItems: 0,
    staleAnchors: 0,
    needsReanchorAnchors: 0,
    revisionRows: 0
  };
}
