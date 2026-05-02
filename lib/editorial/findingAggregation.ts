import {
  type EditorialDecisionRecord,
  isResolvedDecisionStatus,
  latestDecisionByFinding
} from "@/lib/editorial/decisions";
import { classifyDetectedSection } from "@/lib/editorial/structureReview";
import type {
  EditorialChapterInput,
  EditorialFindingInput
} from "@/lib/editorial/nextAction";

export type EditorialDisplayPriority = "critical" | "high" | "medium" | "low";

export type EditorialFindingScope = "manuscript" | "section" | "chunk";

export type EditorialPriorityRepresentativeFinding = {
  id: string;
  sectionId: string | null;
  sectionLabel: string;
  issueType: string;
  severity: number;
  problem: string;
  evidence: string | null;
  recommendation: string;
  rewriteInstruction: string | null;
};

export type EditorialPriority = {
  priorityId: string;
  title: string;
  issueType: string;
  severity: number;
  rawSeverityMax: number;
  rawSeverityRange: string;
  displayPriority: EditorialDisplayPriority;
  displayScore: number;
  affectedSectionIds: string[];
  affectedSectionLabels: string[];
  issueCount: number;
  representativeFindings: EditorialPriorityRepresentativeFinding[];
  evidenceSummary: string;
  editorialImpact: string;
  recommendedAction: string;
  firstConcreteStep: string;
  whatToIgnoreForNow: string;
  shouldActNow: boolean;
  rawFindingIds: string[];
  structuralPattern: string;
  findingScope: EditorialFindingScope | "mixed";
  hasFragmentContext: boolean;
};

export type EditorialFindingAggregationInput = {
  chapters: EditorialChapterInput[];
  findings: EditorialFindingInput[];
  decisions?: EditorialDecisionRecord[];
  limit?: number;
};

type ChapterContext = EditorialChapterInput & {
  heading?: string | null;
};

type PatternDefinition = {
  id: string;
  title: string;
  issueType: string;
  regexes: RegExp[];
  impact: string;
  action: string;
  firstStep: string;
  ignoreForNow: string;
  systemicBoost?: number;
};

type ClassifiedFinding = {
  finding: EditorialFindingInput;
  chapter: ChapterContext | undefined;
  scope: EditorialFindingScope;
  pattern: PatternDefinition;
  wordingKey: string;
  severityBucket: string;
  hasFragmentContext: boolean;
};

type PriorityGroup = {
  key: string;
  classifications: ClassifiedFinding[];
};

const FALLBACK_PATTERN: PatternDefinition = {
  id: "repeated-editorial-finding",
  title: "Repeated editorial finding",
  issueType: "Editorial",
  regexes: [],
  impact:
    "Related findings recur enough to be handled as an editorial pattern instead of separate row-by-row fixes.",
  action:
    "Review the representative examples, decide the governing editorial rule, then apply that rule across the affected sections.",
  firstStep:
    "Open the earliest affected section and write one reusable edit note that can govern the repeated finding.",
  ignoreForNow:
    "Do not resolve every duplicate raw row individually until the shared editorial rule is clear."
};

const PATTERNS: PatternDefinition[] = [
  {
    id: "fragment-sections",
    title: "Possible false splits and fragment sections",
    issueType: "Structure",
    regexes: [
      /\btitle[-\s]?only\b/,
      /\bfalse split\b/,
      /\bfragment(?:ed)? section\b/,
      /\bheading(?: only)?\b/,
      /\btoo short\b/,
      /\bsection map\b/,
      /\bsplit (?:chapter|section|scene)s?\b/
    ],
    impact:
      "Raw scene-level findings on very short or title-like sections can distort the triage order because the section may be an import artifact rather than a full scene.",
    action:
      "Review the chapter and section map before rewriting local scene beats.",
    firstStep:
      "Open the structure inspector and decide which short sections should be merged, renamed, or kept as intentional fragments.",
    ignoreForNow:
      "Ignore isolated no-character, no-conflict, or no-movement rows on one-word sections until the section map is confirmed.",
    systemicBoost: 12
  },
  {
    id: "missing-character-anchor",
    title: "Sections without clear character anchoring",
    issueType: "Character",
    regexes: [
      /\bno (?:clear )?(?:character|protagonist|viewpoint|pov)\b/,
      /\bwithout (?:a )?(?:character|protagonist|viewpoint|pov)\b/,
      /\blacks? (?:a |clear )?(?:character|protagonist|viewpoint|pov)\b/,
      /\bcharacter anchor\b/,
      /\bprotagonist hierarchy\b/
    ],
    impact:
      "Reader orientation weakens when affected sections do not make the active character, viewpoint, or protagonist hierarchy legible.",
    action:
      "Stabilize the protagonist and POV hierarchy across the affected sections.",
    firstStep:
      "For the earliest affected section, name whose desire or viewpoint controls the beat and mark any sections that intentionally withhold that anchor.",
    ignoreForNow:
      "Postpone line edits and isolated wording fixes until the character anchor rule is clear.",
    systemicBoost: 10
  },
  {
    id: "missing-conflict-pressure",
    title: "Repeated missing conflict or dramatic pressure",
    issueType: "Conflict",
    regexes: [
      /\bno (?:clear )?(?:conflict|tension|pressure|stakes)\b/,
      /\bwithout (?:clear )?(?:conflict|tension|pressure|stakes)\b/,
      /\blacks? (?:clear )?(?:conflict|tension|pressure|stakes)\b/,
      /\blow (?:conflict|tension|pressure|stakes)\b/,
      /\bdramatic pressure\b/
    ],
    impact:
      "Scenes without visible conflict or pressure reduce narrative propulsion and make later escalation feel unearned.",
    action:
      "Clarify what pressure, obstacle, or choice drives the affected sections.",
    firstStep:
      "Pick the first affected full scene and write the explicit obstacle, stake, and decision beat it must carry.",
    ignoreForNow:
      "Do not tune prose rhythm or minor continuity rows until the scene pressure is legible.",
    systemicBoost: 10
  },
  {
    id: "missing-scene-movement",
    title: "Sections with little scene movement",
    issueType: "Movement",
    regexes: [
      /\bno (?:clear )?(?:movement|change|turn|progression)\b/,
      /\bwithout (?:clear )?(?:movement|change|turn|progression)\b/,
      /\blacks? (?:clear )?(?:movement|change|turn|progression)\b/,
      /\bstatic\b/,
      /\bscene movement\b/,
      /\bemotional movement\b/,
      /\bcharacter movement\b/
    ],
    impact:
      "Repeated low movement means sections may describe state without changing the dramatic situation.",
    action:
      "Define the before-and-after turn for each affected scene.",
    firstStep:
      "For the earliest affected full scene, write what changes between the first and last paragraph.",
    ignoreForNow:
      "Hold off on sentence-level polishing until each affected scene has a clear turn.",
    systemicBoost: 8
  },
  {
    id: "abrupt-pov-shift",
    title: "Abrupt POV or viewpoint shifts",
    issueType: "POV",
    regexes: [
      /\babrupt (?:pov|point of view|viewpoint) shift\b/,
      /\bunclear (?:pov|point of view|viewpoint)\b/,
      /\bpov shift\b/,
      /\bviewpoint shift\b/,
      /\bhead[-\s]?hop/
    ],
    impact:
      "Unsignaled viewpoint changes make it harder to track whose experience governs the scene.",
    action:
      "Stabilize POV handoffs and mark intentional viewpoint changes.",
    firstStep:
      "List the viewpoint owner for each affected section, then add transition cues where ownership changes.",
    ignoreForNow:
      "Defer local clarity fixes that depend on whose viewpoint the section should use.",
    systemicBoost: 14
  },
  {
    id: "unclear-transition",
    title: "Unclear transitions between sections",
    issueType: "Transition",
    regexes: [
      /\bunclear transition\b/,
      /\babrupt transition\b/,
      /\bmissing transition\b/,
      /\bno transition\b/,
      /\bjarring (?:jump|cut)\b/,
      /\bsection handoff\b/
    ],
    impact:
      "Weak handoffs make the manuscript feel fragmented even when individual scenes are functional.",
    action:
      "Clarify the time, place, cause, or viewpoint handoff between affected sections.",
    firstStep:
      "Map the incoming and outgoing state of the earliest affected transition before adding connective tissue.",
    ignoreForNow:
      "Ignore duplicate local transition rows until the section order and handoff logic are settled.",
    systemicBoost: 10
  },
  {
    id: "unclear-dramatic-contract",
    title: "Dramatic contract or premise is unclear",
    issueType: "Premise",
    regexes: [
      /\bdramatic contract\b/,
      /\breader promise\b/,
      /\bunclear premise\b/,
      /\bclarify (?:the )?premise\b/,
      /\bcentral promise\b/,
      /\bstory promise\b/
    ],
    impact:
      "If the premise or reader promise is unstable, later fixes risk optimizing scenes toward different books.",
    action:
      "Clarify the dramatic contract before resolving downstream scene findings.",
    firstStep:
      "Write a one-sentence reader promise and test the first five affected sections against it.",
    ignoreForNow:
      "Do not chase isolated local issues that may change once the core promise is set.",
    systemicBoost: 18
  },
  {
    id: "late-thriller-ignition",
    title: "Thriller ignition arrives too late",
    issueType: "Pacing",
    regexes: [
      /\bthriller ignition\b/,
      /\binciting (?:incident|pressure)\b/,
      /\bengine starts too late\b/,
      /\bhook starts too late\b/,
      /\bstakes arrive too late\b/,
      /\bmove .* earlier\b/
    ],
    impact:
      "A delayed ignition can make the opening read as setup before the book's core engine is visible.",
    action:
      "Move the thriller engine or decisive pressure earlier in the manuscript.",
    firstStep:
      "Identify the first irreversible pressure beat and decide whether it can appear in the opening sequence.",
    ignoreForNow:
      "Leave minor later-scene cleanup alone until the opening engine is placed.",
    systemicBoost: 16
  }
];

export function aggregateEditorialFindingPriorities({
  chapters,
  findings,
  decisions = [],
  limit
}: EditorialFindingAggregationInput): EditorialPriority[] {
  const decisionByFinding = latestDecisionByFinding(decisions);
  const unresolvedFindings = findings.filter((finding) => {
    const decision = decisionByFinding.get(finding.id);
    return !isResolvedDecisionStatus(decision?.status);
  });
  const chapterById = buildChapterById(chapters);
  const groups = new Map<string, PriorityGroup>();

  for (const finding of unresolvedFindings
    .slice()
    .sort((a, b) => compareFindings(chapterById, a, b))) {
    const classification = classifyFinding(finding, chapterById.get(finding.chapterId ?? ""));
    const key = groupKey(classification);
    const group = groups.get(key) ?? { key, classifications: [] };

    group.classifications.push(classification);
    groups.set(key, group);
  }

  const priorities = Array.from(groups.values())
    .map((group) => buildPriority(group, chapterById))
    .sort(comparePriorities);

  return typeof limit === "number" ? priorities.slice(0, Math.max(0, limit)) : priorities;
}

export function isShortOrTitleLikeSection(
  chapter: Pick<ChapterContext, "title" | "summary" | "wordCount"> & {
    heading?: string | null;
  }
) {
  const wordCount = chapter.wordCount ?? 0;
  const label = `${chapter.heading ?? ""} ${chapter.title}`.trim();
  const labelWords = words(label).length;
  const detectedType = classifyDetectedSection(chapter);

  return (
    wordCount <= 80 ||
    (wordCount <= 150 && labelWords <= 6) ||
    (wordCount <= 140 && detectedType !== "chapter")
  );
}

function buildPriority(
  group: PriorityGroup,
  chapterById: Map<string, ChapterContext>
): EditorialPriority {
  const classifications = group.classifications;
  const findings = classifications.map((classification) => classification.finding);
  const pattern = dominantPattern(classifications);
  const scope = dominantScope(classifications);
  const rawFindingIds = findings.map((finding) => finding.id);
  const severities = findings.map((finding) => normalizeSeverity(finding.severity));
  const rawSeverityMax = Math.max(...severities);
  const rawSeverityMin = Math.min(...severities);
  const affectedSectionIds = unique(
    findings
      .map((finding) => finding.chapterId ?? null)
      .filter((chapterId): chapterId is string => Boolean(chapterId))
  ).sort((a, b) => sectionOrder(chapterById, a) - sectionOrder(chapterById, b));
  const affectedSectionLabels = affectedSectionIds.map((chapterId) =>
    sectionLabel(chapterById, chapterId)
  );
  const representativeFindings = representativeFindingsForGroup(
    classifications,
    chapterById
  );
  const hasFragmentContext = classifications.some(
    (classification) => classification.hasFragmentContext
  );
  const displayScore = displayScoreForGroup({
    classifications,
    rawSeverityMax,
    affectedSectionCount: affectedSectionIds.length,
    pattern
  });
  const displayPriority = displayPriorityForScore(displayScore);
  const issueType = pattern.id === FALLBACK_PATTERN.id
    ? displayIssueType(findings[0]?.issueType)
    : pattern.issueType;
  const title = titleForPriority(pattern, findings);

  return {
    priorityId: `priority-${slugify(group.key)}-${shortHash(rawFindingIds.join("|"))}`,
    title,
    issueType,
    severity: rawSeverityMax,
    rawSeverityMax,
    rawSeverityRange:
      rawSeverityMin === rawSeverityMax
        ? `S${rawSeverityMax}`
        : `S${rawSeverityMin}-S${rawSeverityMax}`,
    displayPriority,
    displayScore,
    affectedSectionIds,
    affectedSectionLabels,
    issueCount: findings.length,
    representativeFindings,
    evidenceSummary: evidenceSummary({
      pattern,
      issueCount: findings.length,
      affectedSectionLabels,
      representatives: representativeFindings,
      hasFragmentContext
    }),
    editorialImpact: pattern.impact,
    recommendedAction:
      pattern.id === FALLBACK_PATTERN.id
        ? fallbackRecommendation(representativeFindings[0])
        : pattern.action,
    firstConcreteStep:
      pattern.id === FALLBACK_PATTERN.id
        ? fallbackFirstStep(representativeFindings[0])
        : pattern.firstStep,
    whatToIgnoreForNow: pattern.ignoreForNow,
    shouldActNow: shouldActNow(displayScore, pattern, affectedSectionIds.length),
    rawFindingIds,
    structuralPattern: pattern.id,
    findingScope: scope,
    hasFragmentContext
  };
}

function classifyFinding(
  finding: EditorialFindingInput,
  chapter: ChapterContext | undefined
): ClassifiedFinding {
  const hasFragmentContext = Boolean(chapter && isShortOrTitleLikeSection(chapter));
  const text = normalizeText(
    [
      finding.issueType,
      finding.problem,
      finding.recommendation,
      finding.rewriteInstruction,
      finding.evidence
    ].join(" ")
  );
  const pattern =
    fragmentPatternForFinding(text, hasFragmentContext) ??
    PATTERNS.find((candidate) => candidate.regexes.some((regex) => regex.test(text))) ??
    FALLBACK_PATTERN;

  return {
    finding,
    chapter,
    scope: findingScope(finding),
    pattern,
    wordingKey: repeatedWordingKey(finding.problem),
    severityBucket: severityBucket(finding.severity),
    hasFragmentContext
  };
}

function fragmentPatternForFinding(text: string, hasFragmentContext: boolean) {
  const fragmentPattern = PATTERNS[0];

  if (fragmentPattern.regexes.some((regex) => regex.test(text))) {
    return fragmentPattern;
  }

  if (!hasFragmentContext) {
    return undefined;
  }

  if (
    /\bno (?:clear )?(?:character|conflict|movement|tension|pressure|stakes|change|turn)\b/.test(text) ||
    /\blacks? (?:a |clear )?(?:character|conflict|movement|tension|pressure|stakes|change|turn)\b/.test(text) ||
    /\bwithout (?:a |clear )?(?:character|conflict|movement|tension|pressure|stakes|change|turn)\b/.test(text)
  ) {
    return fragmentPattern;
  }

  return undefined;
}

function groupKey(classification: ClassifiedFinding) {
  const issueTypeKey =
    classification.pattern.id === FALLBACK_PATTERN.id
      ? normalizeKey(classification.finding.issueType || "editorial")
      : normalizeKey(classification.pattern.issueType);
  const severityKey =
    classification.pattern.id === FALLBACK_PATTERN.id
      ? classification.severityBucket
      : "systemic";
  const wordingKey =
    classification.pattern.id === FALLBACK_PATTERN.id
      ? classification.wordingKey
      : classification.pattern.id;

  return [
    issueTypeKey,
    severityKey,
    wordingKey,
    classification.pattern.id,
    classification.scope
  ].join("|");
}

function displayScoreForGroup({
  classifications,
  rawSeverityMax,
  affectedSectionCount,
  pattern
}: {
  classifications: ClassifiedFinding[];
  rawSeverityMax: number;
  affectedSectionCount: number;
  pattern: PatternDefinition;
}) {
  const issueCount = classifications.length;
  const allFragmentContext = classifications.every(
    (classification) => classification.hasFragmentContext
  );
  let score =
    rawSeverityMax * 11 +
    Math.min(44, Math.log2(issueCount + 1) * 15) +
    Math.min(44, affectedSectionCount * 5);

  if (affectedSectionCount >= 20) {
    score += 46;
  } else if (affectedSectionCount >= 10) {
    score += 32;
  } else if (affectedSectionCount >= 5) {
    score += 20;
  } else if (affectedSectionCount >= 3) {
    score += 10;
  }

  if (classifications.some((classification) => classification.scope === "manuscript")) {
    score += 18;
  }

  score += pattern.systemicBoost ?? 0;

  if (allFragmentContext && affectedSectionCount <= 1) {
    score -= 52;
  } else if (allFragmentContext && affectedSectionCount <= 2) {
    score -= 30;
  }

  if (pattern.id === "fragment-sections" && affectedSectionCount < 4) {
    score -= 18;
  }

  if (issueCount === 1 && affectedSectionCount <= 1) {
    score -= 8;
  }

  return Math.max(1, Math.round(score));
}

function displayPriorityForScore(score: number): EditorialDisplayPriority {
  if (score >= 120) {
    return "critical";
  }
  if (score >= 75) {
    return "high";
  }
  if (score >= 40) {
    return "medium";
  }
  return "low";
}

function shouldActNow(
  score: number,
  pattern: PatternDefinition,
  affectedSectionCount: number
) {
  return (
    score >= 75 ||
    (pattern.id === "fragment-sections" && affectedSectionCount >= 4) ||
    (pattern.id === "unclear-dramatic-contract" && score >= 65)
  );
}

function comparePriorities(a: EditorialPriority, b: EditorialPriority) {
  return (
    b.displayScore - a.displayScore ||
    b.issueCount - a.issueCount ||
    b.affectedSectionIds.length - a.affectedSectionIds.length ||
    b.rawSeverityMax - a.rawSeverityMax ||
    a.title.localeCompare(b.title) ||
    a.priorityId.localeCompare(b.priorityId)
  );
}

function compareFindings(
  chapterById: Map<string, ChapterContext>,
  a: EditorialFindingInput,
  b: EditorialFindingInput
) {
  return (
    normalizeSeverity(b.severity) - normalizeSeverity(a.severity) ||
    sectionOrder(chapterById, a.chapterId) - sectionOrder(chapterById, b.chapterId) ||
    timestamp(a.createdAt) - timestamp(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

function representativeFindingsForGroup(
  classifications: ClassifiedFinding[],
  chapterById: Map<string, ChapterContext>
): EditorialPriorityRepresentativeFinding[] {
  return classifications
    .slice()
    .sort((a, b) => compareFindings(chapterById, a.finding, b.finding))
    .slice(0, 3)
    .map(({ finding }) => ({
      id: finding.id,
      sectionId: finding.chapterId ?? null,
      sectionLabel: finding.chapterId
        ? sectionLabel(chapterById, finding.chapterId)
        : "Manuscript level",
      issueType: displayIssueType(finding.issueType),
      severity: normalizeSeverity(finding.severity),
      problem: finding.problem,
      evidence: finding.evidence?.trim() || null,
      recommendation: finding.recommendation,
      rewriteInstruction: finding.rewriteInstruction?.trim() || null
    }));
}

function evidenceSummary({
  pattern,
  issueCount,
  affectedSectionLabels,
  representatives,
  hasFragmentContext
}: {
  pattern: PatternDefinition;
  issueCount: number;
  affectedSectionLabels: string[];
  representatives: EditorialPriorityRepresentativeFinding[];
  hasFragmentContext: boolean;
}) {
  const sectionSummary =
    affectedSectionLabels.length > 0
      ? formatSectionList(affectedSectionLabels)
      : "manuscript-level findings";
  const examples = representatives
    .map((finding) => truncate(finding.evidence || finding.problem, 110))
    .filter(Boolean);
  const exampleText = examples.length > 0 ? ` Examples: ${examples.join(" / ")}` : "";
  const fragmentNote =
    hasFragmentContext || pattern.id === "fragment-sections"
      ? " Some evidence comes from very short or title-like sections."
      : "";

  return `${issueCount} related finding${issueCount === 1 ? "" : "s"} across ${sectionSummary}.${fragmentNote}${exampleText}`;
}

function titleForPriority(
  pattern: PatternDefinition,
  findings: EditorialFindingInput[]
) {
  if (pattern.id !== FALLBACK_PATTERN.id) {
    return pattern.title;
  }

  const issueType = displayIssueType(findings[0]?.issueType);
  const repeatedProblem = truncate(findings[0]?.problem ?? "Editorial issue", 70);

  return findings.length > 1
    ? `Repeated ${issueType.toLowerCase()}: ${repeatedProblem}`
    : `${issueType}: ${repeatedProblem}`;
}

function fallbackRecommendation(
  representative: EditorialPriorityRepresentativeFinding | undefined
) {
  return (
    representative?.recommendation ||
    "Review the representative findings and define one editorial rule before making local changes."
  );
}

function fallbackFirstStep(
  representative: EditorialPriorityRepresentativeFinding | undefined
) {
  return (
    representative?.rewriteInstruction ||
    representative?.recommendation ||
    FALLBACK_PATTERN.firstStep
  );
}

function dominantPattern(classifications: ClassifiedFinding[]) {
  return classifications[0]?.pattern ?? FALLBACK_PATTERN;
}

function dominantScope(classifications: ClassifiedFinding[]): EditorialFindingScope | "mixed" {
  const scopes = unique(classifications.map((classification) => classification.scope));
  return scopes.length === 1 ? scopes[0] : "mixed";
}

function findingScope(finding: EditorialFindingInput): EditorialFindingScope {
  if (!finding.chapterId) {
    return "manuscript";
  }

  return finding.chunkId ? "chunk" : "section";
}

function buildChapterById(chapters: EditorialChapterInput[]) {
  return new Map(chapters.map((chapter) => [chapter.id, chapter as ChapterContext]));
}

function sectionLabel(chapterById: Map<string, ChapterContext>, chapterId: string) {
  const chapter = chapterById.get(chapterId);

  if (!chapter) {
    return "Unlinked section";
  }

  return `Section ${chapter.order}: ${chapter.title}`;
}

function sectionOrder(
  chapterById: Map<string, ChapterContext>,
  chapterId?: string | null
) {
  if (!chapterId) {
    return Number.MAX_SAFE_INTEGER;
  }

  return chapterById.get(chapterId)?.order ?? Number.MAX_SAFE_INTEGER;
}

function formatSectionList(labels: string[]) {
  const visible = labels.slice(0, 4);
  const remaining = labels.length - visible.length;

  return remaining > 0
    ? `${visible.join(", ")} and ${remaining} more`
    : visible.join(", ");
}

function displayIssueType(value?: string) {
  const text = value?.trim();
  return text ? text : "Editorial";
}

function normalizeSeverity(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(5, Math.max(1, Math.round(value)));
}

function severityBucket(value: number) {
  const severity = normalizeSeverity(value);

  if (severity >= 5) {
    return "s5";
  }
  if (severity >= 4) {
    return "s4";
  }
  if (severity >= 3) {
    return "s3";
  }

  return "s1-s2";
}

function repeatedWordingKey(value: string) {
  const tokens = words(value)
    .filter((token) => !/^\d+$/.test(token))
    .slice(0, 10);

  return tokens.length > 0 ? tokens.join("-") : "general";
}

function words(value: string) {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter(Boolean);
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeKey(value: string) {
  return words(value).join("-") || "editorial";
}

function slugify(value: string) {
  return normalizeKey(value).slice(0, 96);
}

function shortHash(value: string) {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function timestamp(value?: Date | string) {
  if (!value) {
    return 0;
  }

  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}
