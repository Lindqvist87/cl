type DocOnlyManuscriptInput = {
  metadata?: unknown;
  status?: string | null;
  analysisStatus?: string | null;
  chapterCount?: number | null;
  chunkCount?: number | null;
  originalText?: string | null;
};

export function isDocOnlyManuscript(input: DocOnlyManuscriptInput) {
  const metadata = input.metadata;

  const hasPipelineArtifacts =
    (input.chapterCount ?? 0) > 0 || (input.chunkCount ?? 0) > 0;
  const analysisComplete = input.analysisStatus === "COMPLETED";

  if (isJsonRecord(metadata) && metadata.importFlow === "doc-only") {
    return !hasPipelineArtifacts && !analysisComplete;
  }

  return (
    input.status === "UPLOADED" &&
    !analysisComplete &&
    Boolean(input.originalText?.trim()) &&
    (input.chapterCount ?? 0) === 0 &&
    (input.chunkCount ?? 0) === 0
  );
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
