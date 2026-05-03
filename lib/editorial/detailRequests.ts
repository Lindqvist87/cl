import {
  mergeEvidenceAnchors,
  normalizeEvidenceAnchors,
  type EditorialEvidenceAnchor,
  type EvidenceFindingLike
} from "@/lib/editorial/evidence";

export type EditorialDetailRequest = {
  type: "find_supporting_evidence";
  query: string;
  sourceScope?: {
    chapterIds?: string[];
    sectionIds?: string[];
    findingIds?: string[];
    issueTypes?: string[];
  };
  limit?: number;
};

export type EditorialDetailRequestArtifacts = {
  findings: Array<
    EvidenceFindingLike & {
      issueType?: string | null;
      problem?: string | null;
      recommendation?: string | null;
      rewriteInstruction?: string | null;
      severity?: number | null;
    }
  >;
};

export type EditorialDetailRequestResult = {
  request: EditorialDetailRequest;
  evidenceAnchors: EditorialEvidenceAnchor[];
  matchedFindingIds: string[];
};

export function resolveEditorialDetailRequest(
  request: EditorialDetailRequest,
  artifacts: EditorialDetailRequestArtifacts
): EditorialDetailRequestResult {
  if (request.type !== "find_supporting_evidence") {
    return { request, evidenceAnchors: [], matchedFindingIds: [] };
  }

  const queryTokens = tokenSet(request.query);
  const limit = Math.max(1, request.limit ?? 8);
  const matches = artifacts.findings
    .filter((finding) => isInsideScope(finding, request.sourceScope))
    .map((finding) => ({
      finding,
      score: detailScore(queryTokens, finding)
    }))
    .filter((match) => match.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.finding.severity ?? 0) - Number(a.finding.severity ?? 0) ||
        String(a.finding.id ?? "").localeCompare(String(b.finding.id ?? ""))
    )
    .slice(0, limit);

  return {
    request,
    evidenceAnchors: mergeEvidenceAnchors(
      matches.flatMap((match) => normalizeEvidenceAnchors({ finding: match.finding }))
    ),
    matchedFindingIds: matches
      .map((match) => match.finding.id)
      .filter((id): id is string => Boolean(id))
  };
}

function isInsideScope(
  finding: EvidenceFindingLike & { issueType?: string | null },
  scope: EditorialDetailRequest["sourceScope"] = {}
) {
  const chapterIds = new Set([...(scope.chapterIds ?? []), ...(scope.sectionIds ?? [])]);
  const findingIds = new Set(scope.findingIds ?? []);
  const issueTypes = new Set(
    (scope.issueTypes ?? []).map((issueType) => normalize(issueType))
  );

  if (chapterIds.size > 0 && (!finding.chapterId || !chapterIds.has(finding.chapterId))) {
    return false;
  }

  if (findingIds.size > 0 && (!finding.id || !findingIds.has(finding.id))) {
    return false;
  }

  if (
    issueTypes.size > 0 &&
    !issueTypes.has(normalize(finding.issueType ?? ""))
  ) {
    return false;
  }

  return true;
}

function detailScore(
  queryTokens: Set<string>,
  finding: EditorialDetailRequestArtifacts["findings"][number]
) {
  const haystack = tokenSet(
    [
      finding.issueType,
      finding.problem,
      finding.evidence,
      finding.recommendation,
      finding.rewriteInstruction,
      finding.sourceTextExcerpt
    ]
      .filter(Boolean)
      .join(" ")
  );
  let score = 0;

  for (const token of queryTokens) {
    if (haystack.has(token)) {
      score += 1;
    }
  }

  if (score > 0 && finding.chunkId) {
    score += 0.25;
  }

  return score;
}

function tokenSet(value: string) {
  return new Set(
    normalize(value)
      .split(/\s+/)
      .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
      .filter((token) => token.length >= 3)
  );
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
