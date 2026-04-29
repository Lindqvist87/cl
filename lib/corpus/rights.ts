import { RightsStatus } from "@prisma/client";

type CorpusRightsLike = {
  rightsStatus: RightsStatus | string;
  allowedUses?: unknown;
};

export const PROFILE_BENCHMARK_RIGHTS = new Set<string>([
  RightsStatus.PUBLIC_DOMAIN,
  RightsStatus.OPEN_LICENSE,
  RightsStatus.LICENSED,
  RightsStatus.PRIVATE_REFERENCE
]);

export const CHUNK_CONTEXT_RIGHTS = new Set<string>([
  RightsStatus.PUBLIC_DOMAIN,
  RightsStatus.OPEN_LICENSE
]);

export function canUseForCorpusBenchmark(book: CorpusRightsLike) {
  return (
    PROFILE_BENCHMARK_RIGHTS.has(book.rightsStatus) &&
    allowsCorpusBenchmarking(book.allowedUses)
  );
}

export function canUseForChunkContext(book: CorpusRightsLike) {
  return (
    CHUNK_CONTEXT_RIGHTS.has(book.rightsStatus) &&
    allowsCorpusBenchmarking(book.allowedUses)
  );
}

export function rightsStatusCounts(
  values: Array<{ rightsStatus: RightsStatus | string }>
) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value.rightsStatus] = (counts[value.rightsStatus] ?? 0) + 1;
    return counts;
  }, {});
}

function allowsCorpusBenchmarking(allowedUses: unknown) {
  if (!allowedUses || typeof allowedUses !== "object" || Array.isArray(allowedUses)) {
    return true;
  }

  return (allowedUses as { corpusBenchmarking?: unknown }).corpusBenchmarking !== false;
}
