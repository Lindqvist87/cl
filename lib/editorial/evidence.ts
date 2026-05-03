export type EditorialEvidenceGranularity =
  | "paragraph"
  | "chunk"
  | "scene"
  | "chapter"
  | "manuscript";

export type EditorialEvidenceAnchor = {
  manuscriptId?: string | null;
  chapterId?: string | null;
  sceneId?: string | null;
  paragraphId?: string | null;
  paragraphStart?: number | null;
  paragraphEnd?: number | null;
  chunkId?: string | null;
  sourceTextExcerpt?: string | null;
  reason?: string | null;
  granularity: EditorialEvidenceGranularity;
  confidence?: number | null;
  findingId?: string;
};

export type EvidenceSourceChunk = {
  id?: string | null;
  sceneId?: string | null;
  paragraphStart?: number | null;
  paragraphEnd?: number | null;
  startParagraph?: number | null;
  endParagraph?: number | null;
  text?: string | null;
};

export type EvidenceSourceChapter = {
  id?: string | null;
  title?: string | null;
};

export type EvidenceFindingLike = {
  id?: string;
  manuscriptId?: string | null;
  chapterId?: string | null;
  sceneId?: string | null;
  paragraphId?: string | null;
  paragraphStart?: number | null;
  paragraphEnd?: number | null;
  chunkId?: string | null;
  confidence?: number | null;
  evidence?: string | null;
  evidenceAnchors?: unknown;
  sourceTextExcerpt?: string | null;
  evidenceReason?: string | null;
  chunk?: EvidenceSourceChunk | null;
  chapter?: EvidenceSourceChapter | null;
};

export type NormalizeEvidenceAnchorInput = {
  finding: EvidenceFindingLike;
  manuscriptId?: string | null;
  chapterId?: string | null;
  chunkId?: string | null;
  chunk?: EvidenceSourceChunk | null;
  chapter?: EvidenceSourceChapter | null;
  fallbackGranularity?: EditorialEvidenceGranularity;
};

export function normalizeEvidenceAnchors({
  finding,
  manuscriptId,
  chapterId,
  chunkId,
  chunk,
  chapter,
  fallbackGranularity
}: NormalizeEvidenceAnchorInput): EditorialEvidenceAnchor[] {
  const sourceChunk = chunk ?? finding.chunk ?? null;
  const sourceChapter = chapter ?? finding.chapter ?? null;
  const anchors = rawEvidenceAnchors(finding.evidenceAnchors).map((anchor) =>
    normalizeAnchor(anchor, {
      finding,
      manuscriptId,
      chapterId,
      chunkId,
      chunk: sourceChunk,
      chapter: sourceChapter,
      fallbackGranularity
    })
  );

  if (anchors.length > 0) {
    return mergeEvidenceAnchors(anchors);
  }

  const fallback = fallbackEvidenceAnchor({
    finding,
    manuscriptId,
    chapterId,
    chunkId,
    chunk: sourceChunk,
    fallbackGranularity
  });

  return fallback ? [fallback] : [];
}

export function mergeEvidenceAnchors(
  anchors: EditorialEvidenceAnchor[]
): EditorialEvidenceAnchor[] {
  const merged = new Map<string, EditorialEvidenceAnchor>();

  for (const anchor of anchors) {
    const normalized = normalizeAnchor(anchor, {
      finding: {},
      fallbackGranularity: anchor.granularity
    });
    const key = anchorKey(normalized);

    if (!merged.has(key)) {
      merged.set(key, normalized);
    }
  }

  return Array.from(merged.values());
}

export function formatFindingEvidenceForStorage(
  finding: EvidenceFindingLike,
  context: Omit<NormalizeEvidenceAnchorInput, "finding"> = {}
) {
  const anchors = normalizeEvidenceAnchors({ finding, ...context });
  const anchor = anchors[0];

  if (!anchor) {
    return cleanText(finding.evidence) || null;
  }

  const excerpt = cleanText(anchor.sourceTextExcerpt) || cleanText(finding.evidence);
  const reason = cleanText(anchor.reason) || cleanText(finding.evidenceReason);
  const location = evidenceLocationLabel(anchor);
  const parts = [`Bevis i texten (${swedishGranularity(anchor.granularity)}${location}):`];

  if (excerpt) {
    parts.push(`"${truncate(excerpt, 260)}"`);
  }

  if (reason && reason !== excerpt) {
    parts.push(`Stöd: ${truncate(reason, 220)}`);
  }

  return parts.join(" ");
}

export function evidenceAnchorPreview(anchor: EditorialEvidenceAnchor) {
  const excerpt = cleanText(anchor.sourceTextExcerpt);
  const reason = cleanText(anchor.reason);
  const location = evidenceLocationLabel(anchor);
  const base = `${swedishGranularity(anchor.granularity)}${location}`;

  if (excerpt && reason) {
    return `${base}: "${truncate(excerpt, 140)}" - ${truncate(reason, 120)}`;
  }

  if (excerpt) {
    return `${base}: "${truncate(excerpt, 180)}"`;
  }

  if (reason) {
    return `${base}: ${truncate(reason, 180)}`;
  }

  return base;
}

function normalizeAnchor(
  value: unknown,
  context: NormalizeEvidenceAnchorInput
): EditorialEvidenceAnchor {
  const record = isRecord(value) ? value : {};
  const finding = context.finding;
  const sourceChunk = context.chunk ?? finding.chunk ?? null;
  const sourceChapter = context.chapter ?? finding.chapter ?? null;
  const paragraphStart = numberOrNull(
    record.paragraphStart,
    record.startParagraph,
    finding.paragraphStart,
    sourceChunk?.paragraphStart,
    sourceChunk?.startParagraph
  );
  const paragraphEnd = numberOrNull(
    record.paragraphEnd,
    record.endParagraph,
    finding.paragraphEnd,
    sourceChunk?.paragraphEnd,
    sourceChunk?.endParagraph
  );
  const chunkId = stringOrNull(record.chunkId, finding.chunkId, context.chunkId, sourceChunk?.id);
  const chapterId = stringOrNull(
    record.chapterId,
    finding.chapterId,
    context.chapterId,
    sourceChapter?.id
  );
  const sceneId = stringOrNull(record.sceneId, finding.sceneId, sourceChunk?.sceneId);
  const paragraphId = stringOrNull(record.paragraphId, finding.paragraphId);

  return {
    manuscriptId: stringOrNull(record.manuscriptId, finding.manuscriptId, context.manuscriptId),
    chapterId,
    sceneId,
    paragraphId,
    paragraphStart,
    paragraphEnd,
    chunkId,
    sourceTextExcerpt: cleanText(
      record.sourceTextExcerpt,
      record.excerpt,
      finding.sourceTextExcerpt,
      finding.evidence
    ),
    reason: cleanText(record.reason, record.evidenceReason, finding.evidenceReason),
    granularity: normalizeGranularity(
      record.granularity,
      context.fallbackGranularity,
      paragraphId,
      paragraphStart,
      chunkId,
      sceneId,
      chapterId
    ),
    confidence: numberOrNull(record.confidence, finding.confidence),
    findingId: stringOrNull(record.findingId, finding.id) ?? undefined
  };
}

function fallbackEvidenceAnchor({
  finding,
  manuscriptId,
  chapterId,
  chunkId,
  chunk,
  fallbackGranularity
}: NormalizeEvidenceAnchorInput): EditorialEvidenceAnchor | null {
  const sourceChunk = chunk ?? finding.chunk ?? null;
  const paragraphStart =
    numberOrNull(finding.paragraphStart, sourceChunk?.paragraphStart, sourceChunk?.startParagraph);
  const paragraphEnd =
    numberOrNull(finding.paragraphEnd, sourceChunk?.paragraphEnd, sourceChunk?.endParagraph);
  const resolvedChunkId = stringOrNull(finding.chunkId, chunkId, sourceChunk?.id);
  const resolvedChapterId = stringOrNull(finding.chapterId, chapterId);
  const excerpt =
    cleanText(finding.sourceTextExcerpt, finding.evidence) ||
    (sourceChunk?.text ? truncate(cleanText(sourceChunk.text) ?? "", 260) : null);

  if (
    !stringOrNull(finding.manuscriptId, manuscriptId) &&
    !resolvedChapterId &&
    !resolvedChunkId &&
    !excerpt
  ) {
    return null;
  }

  return {
    manuscriptId: stringOrNull(finding.manuscriptId, manuscriptId),
    chapterId: resolvedChapterId,
    sceneId: stringOrNull(finding.sceneId, sourceChunk?.sceneId),
    paragraphId: stringOrNull(finding.paragraphId),
    paragraphStart,
    paragraphEnd,
    chunkId: resolvedChunkId,
    sourceTextExcerpt: excerpt,
    reason: cleanText(finding.evidenceReason),
    granularity:
      fallbackGranularity ??
      normalizeGranularity(
        undefined,
        undefined,
        finding.paragraphId,
        undefined,
        resolvedChunkId,
        sourceChunk?.sceneId,
        resolvedChapterId
      ),
    confidence: numberOrNull(finding.confidence),
    findingId: finding.id
  };
}

function rawEvidenceAnchors(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeGranularity(
  value: unknown,
  fallback: EditorialEvidenceGranularity | undefined,
  paragraphId: unknown,
  paragraphStart: unknown,
  chunkId: unknown,
  sceneId: unknown,
  chapterId: unknown
): EditorialEvidenceGranularity {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (isEvidenceGranularity(normalized)) {
    return normalized;
  }

  if (fallback) {
    return fallback;
  }

  if (paragraphId || paragraphStart !== null && paragraphStart !== undefined) {
    return "paragraph";
  }

  if (chunkId) {
    return "chunk";
  }

  if (sceneId) {
    return "scene";
  }

  if (chapterId) {
    return "chapter";
  }

  return "manuscript";
}

function isEvidenceGranularity(value: string): value is EditorialEvidenceGranularity {
  return ["paragraph", "chunk", "scene", "chapter", "manuscript"].includes(value);
}

function anchorKey(anchor: EditorialEvidenceAnchor) {
  return [
    anchor.manuscriptId ?? "",
    anchor.chapterId ?? "",
    anchor.sceneId ?? "",
    anchor.paragraphId ?? "",
    anchor.paragraphStart ?? "",
    anchor.paragraphEnd ?? "",
    anchor.chunkId ?? "",
    normalizeForKey(anchor.sourceTextExcerpt ?? ""),
    normalizeForKey(anchor.reason ?? "")
  ].join("|");
}

function evidenceLocationLabel(anchor: EditorialEvidenceAnchor) {
  const ranges =
    anchor.paragraphStart && anchor.paragraphEnd
      ? anchor.paragraphStart === anchor.paragraphEnd
        ? `, stycke ${anchor.paragraphStart}`
        : `, stycken ${anchor.paragraphStart}-${anchor.paragraphEnd}`
      : "";

  return ranges;
}

function swedishGranularity(granularity: EditorialEvidenceGranularity) {
  const labels: Record<EditorialEvidenceGranularity, string> = {
    paragraph: "stycken",
    chunk: "textavsnitt",
    scene: "scen",
    chapter: "manusdel",
    manuscript: "helmanus"
  };

  return labels[granularity];
}

function stringOrNull(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function numberOrNull(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }

  return null;
}

function cleanText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.replace(/\s+/g, " ").trim();
    }
  }

  return null;
}

function normalizeForKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
