import type {
  EditorialMemoryAnchorChange,
  EditorialMemoryStatus
} from "./types";

export type ExistingEditorialMemoryAnchor = {
  id: string;
  itemId: string;
  manuscriptId: string;
  status?: EditorialMemoryStatus;
  nodeId?: string | null;
  chapterId?: string | null;
  sceneId?: string | null;
  chunkId?: string | null;
  textHash?: string | null;
  revision?: number | null;
};

export type AnchorStalePlanEntry = {
  anchorId: string;
  itemId: string;
  status: Exclude<EditorialMemoryStatus, "ACTIVE" | "SUPERSEDED">;
  reason: string;
};

export function planAnchorStaleUpdates(
  anchors: ExistingEditorialMemoryAnchor[],
  changes: EditorialMemoryAnchorChange[]
): AnchorStalePlanEntry[] {
  const planned = new Map<string, AnchorStalePlanEntry>();

  for (const anchor of anchors) {
    if (anchor.status && anchor.status !== "ACTIVE") {
      continue;
    }

    const change = changes.find((candidate) => anchorMatchesChange(anchor, candidate));
    if (!change) {
      continue;
    }

    const status = classifyAnchorChange(anchor, change);
    if (!status) {
      continue;
    }

    planned.set(anchor.id, {
      anchorId: anchor.id,
      itemId: anchor.itemId,
      status,
      reason: change.reason ?? defaultReason(status)
    });
  }

  return [...planned.values()];
}

function classifyAnchorChange(
  anchor: ExistingEditorialMemoryAnchor,
  change: EditorialMemoryAnchorChange
): "STALE" | "NEEDS_REANCHOR" | null {
  if (
    change.textHash !== undefined &&
    anchor.textHash &&
    change.textHash !== anchor.textHash
  ) {
    return "NEEDS_REANCHOR";
  }

  if (
    change.revision !== undefined &&
    anchor.revision !== null &&
    anchor.revision !== undefined &&
    change.revision !== anchor.revision
  ) {
    return "STALE";
  }

  if (change.textHash !== undefined && !anchor.textHash) {
    return "NEEDS_REANCHOR";
  }

  return null;
}

function anchorMatchesChange(
  anchor: ExistingEditorialMemoryAnchor,
  change: EditorialMemoryAnchorChange
) {
  const scopedFields = ["nodeId", "chunkId", "sceneId", "chapterId"] as const;
  const hasScope = scopedFields.some((field) => change[field] != null);
  if (!hasScope) {
    return true;
  }

  return scopedFields.some(
    (field) => change[field] != null && change[field] === anchor[field]
  );
}

function defaultReason(status: "STALE" | "NEEDS_REANCHOR") {
  return status === "STALE"
    ? "Source revision changed."
    : "Anchored source text changed and should be reanchored.";
}
