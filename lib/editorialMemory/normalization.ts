import { hashJson } from "../compiler/hash";
import type {
  EditorialMemoryAnchorInput,
  NormalizedEditorialMemoryItem,
  RawEditorialMemoryItem
} from "./types";

export function extractRawEditorialMemoryItems(rawOutput: unknown): RawEditorialMemoryItem[] {
  if (Array.isArray(rawOutput)) {
    return rawOutput.filter(isRecord) as RawEditorialMemoryItem[];
  }

  const record = asRecord(rawOutput);
  if (!record) {
    return [];
  }

  for (const key of ["items", "memories", "memoryItems", "facts"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord) as RawEditorialMemoryItem[];
    }
  }

  return [];
}

export function normalizeEditorialMemoryItems(
  rawItems: RawEditorialMemoryItem[]
): NormalizedEditorialMemoryItem[] {
  return rawItems
    .map((item) => normalizeEditorialMemoryItem(item))
    .filter((item): item is NormalizedEditorialMemoryItem => item !== null);
}

function normalizeEditorialMemoryItem(
  item: RawEditorialMemoryItem
): NormalizedEditorialMemoryItem | null {
  const content = firstNonEmptyString(item.content, item.text, item.value);
  if (!content) {
    return null;
  }

  const type = sanitizeKeyPart(item.type ?? "editorial_note");
  const title = firstNonEmptyString(item.title) ?? null;
  const key = item.key?.trim() || buildMemoryKey(type, title, content);
  const confidence = clampConfidence(item.confidence);
  const anchors = normalizeAnchors(item);

  return {
    key,
    type,
    title,
    content,
    confidence,
    metadata: item.metadata ?? null,
    anchors
  };
}

function normalizeAnchors(item: RawEditorialMemoryItem): EditorialMemoryAnchorInput[] {
  const anchors = [
    ...(Array.isArray(item.anchors) ? item.anchors : []),
    ...(item.anchor ? [item.anchor] : [])
  ].filter(Boolean);

  if (anchors.length > 0) {
    return anchors.map((anchor) => ({
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
      sourceTextSnippet: anchor.sourceTextSnippet ?? item.sourceTextSnippet ?? null,
      metadata: anchor.metadata ?? null
    }));
  }

  return item.sourceTextSnippet
    ? [{ sourceTextSnippet: item.sourceTextSnippet }]
    : [];
}

function buildMemoryKey(type: string, title: string | null, content: string) {
  return `${type}:${hashJson({ title, content }).slice(0, 16)}`;
}

function sanitizeKeyPart(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "editorial_note";
}

function clampConfidence(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

function firstNonEmptyString(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
