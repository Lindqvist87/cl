import type { ManuscriptFormat } from "@prisma/client";
import { hashJson, hashText } from "@/lib/compiler/hash";
import type { JsonRecord } from "@/lib/types";
import {
  MANUSCRIPT_IR_VERSION,
  type ImportManifest,
  type ImportReviewStatus,
  type ImportWarning,
  type ManuscriptIRBlock
} from "@/lib/import/v2/types";

export const IMPORT_MANIFEST_METADATA_KEY = "importManifestV2";

export function createImportManifest(input: {
  parserVersion: string;
  sourceFileName: string;
  sourceMimeType?: string;
  sourceFormat: ManuscriptFormat | string;
  fileHash: string;
  blocks: Array<
    Omit<ManuscriptIRBlock, "textHash" | "warnings"> & {
      warnings?: ImportWarning[];
    }
  >;
  warnings?: ImportWarning[];
  metadata?: JsonRecord;
}): ImportManifest {
  const blocks = input.blocks.map((block, index) => {
    const text = normalizeBlockText(block.text);

    return {
      ...block,
      id: block.id || blockId(index),
      order: block.order,
      text,
      textHash: hashText(text),
      confidence: clampConfidence(block.confidence),
      warnings: block.warnings ?? []
    };
  });
  const blockWarnings = blocks.flatMap((block) => block.warnings);
  const warnings = [...(input.warnings ?? []), ...blockWarnings];
  const normalizedText = importManifestToNormalizedText({ blocks });
  const structureHash = hashJson({
    version: MANUSCRIPT_IR_VERSION,
    parserVersion: input.parserVersion,
    blocks: blocks.map((block) => ({
      order: block.order,
      type: block.type,
      headingLevel: block.headingLevel ?? null,
      headingType: block.headingType ?? null,
      textHash: block.textHash,
      confidence: block.confidence,
      sourceAnchor: {
        path: block.sourceAnchor.path,
        paragraphIndex: block.sourceAnchor.paragraphIndex,
        styleId: block.sourceAnchor.styleId,
        styleName: block.sourceAnchor.styleName
      }
    }))
  });
  const criticalWarnings = warnings.filter(
    (warning) => warning.severity === "critical"
  );
  const reviewStatus = reviewStatusFromWarnings(warnings, blocks);
  const manifest: ImportManifest = {
    version: MANUSCRIPT_IR_VERSION,
    parserVersion: input.parserVersion,
    sourceFileName: input.sourceFileName,
    sourceMimeType: input.sourceMimeType,
    sourceFormat: input.sourceFormat,
    fileHash: input.fileHash,
    normalizedTextHash: hashText(normalizedText),
    structureHash,
    createdAt: new Date().toISOString(),
    confidence: averageConfidence(blocks),
    warnings,
    blocks,
    review: {
      status: reviewStatus,
      verifiedEnough:
        reviewStatus === "verified_enough" || reviewStatus === "approved",
      warningCount: warnings.length,
      requiredActions: requiredActionsFromWarnings(warnings),
      structureRevision: 1,
      operations: []
    },
    metadata: input.metadata
  };

  if (criticalWarnings.length > 0) {
    manifest.review.verifiedEnough = false;
  }

  return manifest;
}

export function importManifestToNormalizedText(input: Pick<ImportManifest, "blocks">) {
  return input.blocks
    .filter(
      (block) =>
        block.type !== "page_break" &&
        block.type !== "comment" &&
        block.type !== "track_change"
    )
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function importSignatureFromManifest(manifest: ImportManifest) {
  return hashJson({
    version: manifest.version,
    parserVersion: manifest.parserVersion,
    fileHash: manifest.fileHash,
    structureHash: manifest.structureHash,
    reviewStatus: manifest.review.status,
    structureRevision: manifest.review.structureRevision
  });
}

export function metadataWithImportManifest(
  metadata: unknown,
  manifest: ImportManifest
): JsonRecord {
  const current = recordFromUnknown(metadata);
  const currentImport = recordFromUnknown(current.import);
  const signature = importSignatureFromManifest(manifest);

  return {
    ...current,
    [IMPORT_MANIFEST_METADATA_KEY]: manifest,
    importV2: {
      version: manifest.version,
      parserVersion: manifest.parserVersion,
      sourceHash: manifest.fileHash,
      normalizedTextHash: manifest.normalizedTextHash,
      structureHash: manifest.structureHash,
      signature,
      reviewStatus: manifest.review.status,
      verifiedEnough: manifest.review.verifiedEnough,
      warningCount: manifest.review.warningCount
    },
    import: {
      ...currentImport,
      parserVersion: manifest.parserVersion,
      sourceHash: manifest.fileHash,
      structureHash: manifest.structureHash,
      importSignature: signature
    }
  };
}

export function importManifestFromMetadata(metadata: unknown): ImportManifest | null {
  const record = recordFromUnknown(metadata);
  const candidate = record[IMPORT_MANIFEST_METADATA_KEY] ?? record.importManifest;

  return isImportManifest(candidate) ? candidate : null;
}

export function importSignatureFromMetadata(metadata: unknown) {
  const record = recordFromUnknown(metadata);
  const importV2 = recordFromUnknown(record.importV2);
  const signature = importV2.signature;

  return typeof signature === "string" && signature ? signature : null;
}

export function warning(input: {
  code: string;
  message: string;
  severity?: ImportWarning["severity"];
  blockId?: string;
  confidence?: number;
  metadata?: JsonRecord;
}): ImportWarning {
  return {
    code: input.code,
    message: input.message,
    severity: input.severity ?? "warning",
    blockId: input.blockId,
    confidence: input.confidence,
    metadata: input.metadata
  };
}

export function recordFromUnknown(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function isImportManifest(value: unknown): value is ImportManifest {
  const record = recordFromUnknown(value);
  return (
    record.version === MANUSCRIPT_IR_VERSION &&
    typeof record.parserVersion === "string" &&
    typeof record.fileHash === "string" &&
    typeof record.structureHash === "string" &&
    Array.isArray(record.blocks)
  );
}

function reviewStatusFromWarnings(
  warnings: ImportWarning[],
  blocks: ManuscriptIRBlock[]
): ImportReviewStatus {
  if (warnings.some((item) => item.severity === "critical")) {
    return "unverified";
  }

  if (warnings.some((item) => item.severity === "warning")) {
    return "needs_review";
  }

  return averageConfidence(blocks) >= 0.7 ? "verified_enough" : "needs_review";
}

function requiredActionsFromWarnings(warnings: ImportWarning[]) {
  const actions = new Set<string>();

  if (warnings.length > 0) {
    actions.add("review_warnings");
  }

  if (warnings.some((item) => item.code.includes("chapter"))) {
    actions.add("review_chapter_splits");
  }

  if (warnings.some((item) => item.code.includes("docx"))) {
    actions.add("review_docx_markup");
  }

  return [...actions];
}

function averageConfidence(blocks: Array<{ confidence: number }>) {
  if (blocks.length === 0) {
    return 0;
  }

  const sum = blocks.reduce((total, block) => total + block.confidence, 0);
  return Math.round((sum / blocks.length) * 100) / 100;
}

function normalizeBlockText(value: string) {
  return value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

function blockId(index: number) {
  return `ir-block-${index + 1}`;
}
