import { hashJson, hashText } from "@/lib/compiler/hash";
import type {
  ImportHeadingType,
  ImportManifest,
  ImportReviewOperation,
  ImportReviewOperationType,
  ManuscriptIRBlock
} from "@/lib/import/v2/types";

export type ImportReviewAction =
  | {
      type: "rename";
      blockId: string;
      title: string;
    }
  | {
      type: "reclassify";
      blockId: string;
      headingType: ImportHeadingType;
    }
  | {
      type: "split";
      blockId: string;
      atBlockId: string;
    }
  | {
      type: "merge";
      blockId: string;
      targetBlockId: string;
    }
  | {
      type: "approve";
    };

export function applyImportReviewAction(
  manifest: ImportManifest,
  action: ImportReviewAction
): ImportManifest {
  const now = new Date().toISOString();
  const operation = operationFromAction(action, now);
  const nextBlocks = applyBlocks(manifest.blocks, action);
  const nextReviewStatus =
    action.type === "approve" ? "approved" : "verified_enough";
  const nextManifest: ImportManifest = {
    ...manifest,
    blocks: nextBlocks,
    structureHash: hashJson({
      previous: manifest.structureHash,
      action,
      blocks: nextBlocks.map((block) => ({
        id: block.id,
        order: block.order,
        type: block.type,
        headingType: block.headingType,
        textHash: block.textHash
      }))
    }),
    review: {
      ...manifest.review,
      status: nextReviewStatus,
      verifiedEnough: true,
      structureRevision: manifest.review.structureRevision + 1,
      updatedAt: now,
      operations: [...manifest.review.operations, operation]
    }
  };

  return nextManifest;
}

function applyBlocks(
  blocks: ManuscriptIRBlock[],
  action: ImportReviewAction
): ManuscriptIRBlock[] {
  switch (action.type) {
    case "rename":
      return blocks.map((block) =>
        block.id === action.blockId
          ? {
              ...block,
              text: action.title.trim() || block.text,
              textHash: hashText(action.title.trim() || block.text)
            }
          : block
      );
    case "reclassify":
      return blocks.map((block) =>
        block.id === action.blockId
          ? {
              ...block,
              type: "heading",
              headingType: action.headingType,
              confidence: Math.max(block.confidence, 0.85)
            }
          : block
      );
    case "split":
      return blocks.map((block) =>
        block.id === action.atBlockId
          ? {
              ...block,
              type: "heading",
              headingType: "section",
              confidence: Math.max(block.confidence, 0.82)
            }
          : block
      );
    case "merge":
      return blocks.map((block) =>
        block.id === action.blockId
          ? {
              ...block,
              type: "paragraph",
              headingType: undefined,
              headingLevel: undefined
            }
          : block
      );
    case "approve":
      return blocks;
  }
}

function operationFromAction(
  action: ImportReviewAction,
  createdAt: string
): ImportReviewOperation {
  const base = {
    type: action.type as ImportReviewOperationType,
    createdAt
  };

  switch (action.type) {
    case "rename":
      return { ...base, blockId: action.blockId, value: action.title };
    case "reclassify":
      return { ...base, blockId: action.blockId, value: action.headingType };
    case "split":
      return {
        ...base,
        blockId: action.blockId,
        targetBlockId: action.atBlockId
      };
    case "merge":
      return {
        ...base,
        blockId: action.blockId,
        targetBlockId: action.targetBlockId
      };
    case "approve":
      return base;
  }
}
