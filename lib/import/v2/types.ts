import type { ManuscriptFormat } from "@prisma/client";
import type { JsonRecord } from "@/lib/types";

export const MANUSCRIPT_IR_VERSION = "manuscript-ir-v2";
export const TEXT_IMPORT_PARSER_VERSION = "manuscript-ir-v2-text-1";
export const DOCX_IMPORT_PARSER_VERSION = "manuscript-ir-v2-docx-1";

export type ImportBlockType =
  | "title"
  | "front_matter"
  | "heading"
  | "paragraph"
  | "scene_break"
  | "page_break"
  | "list_item"
  | "comment"
  | "track_change";

export type ImportHeadingType =
  | "title"
  | "front_matter"
  | "part"
  | "chapter"
  | "scene"
  | "section"
  | "unknown";

export type ImportWarningSeverity = "info" | "warning" | "critical";

export type ImportWarning = {
  code: string;
  message: string;
  severity: ImportWarningSeverity;
  blockId?: string;
  confidence?: number;
  metadata?: JsonRecord;
  chapterOrder?: number;
  heading?: string;
  wordCount?: number;
  count?: number;
  total?: number;
};

export type ImportSourceAnchor = {
  sourceFileName: string;
  sourceFormat?: ManuscriptFormat | string;
  path?: string;
  paragraphIndex?: number;
  runIndex?: number;
  styleId?: string;
  styleName?: string;
  commentId?: string;
  revisionId?: string;
};

export type ImportOffset = {
  blockIndex: number;
  paragraphIndex?: number;
  characterStart?: number;
  characterEnd?: number;
};

export type ManuscriptIRBlock = {
  id: string;
  order: number;
  type: ImportBlockType;
  text: string;
  headingLevel?: number;
  headingType?: ImportHeadingType;
  sourceAnchor: ImportSourceAnchor;
  offset: ImportOffset;
  textHash: string;
  confidence: number;
  warnings: ImportWarning[];
  list?: {
    level?: number;
    numId?: string;
  };
  pageBreakBefore?: boolean;
  metadata?: JsonRecord;
};

export type ImportReviewStatus =
  | "unverified"
  | "needs_review"
  | "verified_enough"
  | "approved";

export type ImportReviewOperationType =
  | "split"
  | "merge"
  | "rename"
  | "reclassify"
  | "approve";

export type ImportReviewOperation = {
  type: ImportReviewOperationType;
  blockId?: string;
  targetBlockId?: string;
  value?: string;
  createdAt: string;
};

export type ImportManifest = {
  version: typeof MANUSCRIPT_IR_VERSION;
  parserVersion: string;
  sourceFileName: string;
  sourceMimeType?: string;
  sourceFormat: ManuscriptFormat | string;
  fileHash: string;
  normalizedTextHash: string;
  structureHash: string;
  createdAt: string;
  confidence: number;
  warnings: ImportWarning[];
  blocks: ManuscriptIRBlock[];
  review: {
    status: ImportReviewStatus;
    verifiedEnough: boolean;
    warningCount: number;
    requiredActions: string[];
    structureRevision: number;
    operations: ImportReviewOperation[];
    updatedAt?: string;
  };
  metadata?: JsonRecord;
};
