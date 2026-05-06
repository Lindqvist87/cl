export const EDITORIAL_MEMORY_STATUSES = [
  "ACTIVE",
  "STALE",
  "NEEDS_REANCHOR",
  "SUPERSEDED"
] as const;

export type EditorialMemoryStatus = (typeof EDITORIAL_MEMORY_STATUSES)[number];

export type EditorialMemoryAnchorInput = {
  nodeId?: string | null;
  chapterId?: string | null;
  sceneId?: string | null;
  chunkId?: string | null;
  paragraphStart?: number | null;
  paragraphEnd?: number | null;
  startOffset?: number | null;
  endOffset?: number | null;
  textHash?: string | null;
  revision?: number | null;
  sourceTextSnippet?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type RawEditorialMemoryItem = {
  key?: string | null;
  type?: string | null;
  title?: string | null;
  content?: string | null;
  text?: string | null;
  value?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown> | null;
  anchors?: EditorialMemoryAnchorInput[] | null;
  anchor?: EditorialMemoryAnchorInput | null;
  sourceTextSnippet?: string | null;
};

export type NormalizedEditorialMemoryItem = {
  key: string;
  type: string;
  title: string | null;
  content: string;
  confidence: number;
  metadata: Record<string, unknown> | null;
  anchors: EditorialMemoryAnchorInput[];
};

export type EditorialMemorySourceInput = {
  sourceType?: string;
  sourceId?: string | null;
  promptVersion?: string | null;
  model?: string | null;
  provenance?: Record<string, unknown> | null;
};

export type EditorialMemoryUpsertInput = {
  manuscriptId: string;
  analysisRunId?: string | null;
  analysisOutputId?: string | null;
  snapshotId?: string | null;
  rawOutput: unknown;
  items?: RawEditorialMemoryItem[];
  source?: EditorialMemorySourceInput;
};

export type EditorialMemoryUpsertResult = {
  upserted: number;
  created: number;
  updated: number;
  sourceRows: number;
  anchorRows: number;
  revisionRows: number;
  itemKeys: string[];
};

export type EditorialMemoryAnchorChange = {
  nodeId?: string | null;
  chapterId?: string | null;
  sceneId?: string | null;
  chunkId?: string | null;
  textHash?: string | null;
  revision?: number | null;
  reason?: string;
};

export type EditorialMemoryStaleResult = {
  staleItems: number;
  needsReanchorItems: number;
  staleAnchors: number;
  needsReanchorAnchors: number;
  revisionRows: number;
};
