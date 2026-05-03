import type { EditorialEvidenceAnchor } from "@/lib/editorial/evidence";

export type FindingDraft = {
  problemTitle?: string;
  problemType?: string;
  issueType: string;
  severity: number;
  priority?: number;
  confidence: number;
  problem: string;
  whyItMatters?: string;
  doThisNow?: string;
  affectedChapters?: string[];
  affectedSections?: string[];
  scope?: "local" | "chapter" | "global";
  evidence?: string;
  sourceTextExcerpt?: string;
  evidenceReason?: string;
  evidenceAnchors?: EditorialEvidenceAnchor[];
  recommendation: string;
  rewriteInstruction?: string;
};

export type ChunkAnalysisResult = {
  summary: string;
  sceneFunction: string;
  metrics: {
    tension: number;
    exposition: number;
    dialogue: number;
    action: number;
    introspection: number;
    clarity: number;
    hookStrength: number;
    characterMovement: number;
  };
  possibleCuts: string[];
  findings: FindingDraft[];
};

export type ChapterAnalysisResult = {
  summary: string;
  openingHook: string;
  chapterPromise: string;
  conflict: string;
  pacing: string;
  emotionalMovement: string;
  characterDevelopment: string;
  endingPull: string;
  suggestedEdits: string[];
  rewriteInstructions: string[];
  findings: FindingDraft[];
};

export type WholeBookAnalysisResult = {
  executiveSummary: string;
  commercialManuscriptScore: number;
  premise: string;
  genreFit: string;
  targetReader: string;
  structure: string;
  actMovement: string;
  characterArcs: string;
  pacingCurve: unknown;
  theme: string;
  marketFit: string;
  topIssues: FindingDraft[];
  valueRaisingEdits: string[];
};

export type CorpusComparisonResult = {
  summary: string;
  similarBooks: Array<{
    title: string;
    author?: string;
    reason: string;
    rightsStatus?: string;
  }>;
  structuralDivergences: string[];
  ratioComparisons: Record<string, unknown>;
  openingPatternComparison: string;
  benchmarkNotes: string[];
  resemblanceNotes?: string[];
  usefulDivergences?: string[];
  riskyDivergences?: string[];
  patternSuggestions?: string[];
  chapterLevelSuggestions?: Array<Record<string, unknown>>;
  rewritePatternNotes?: string[];
  findings: FindingDraft[];
};

export type TrendComparisonResult = {
  summary: string;
  signalStrength: "weak" | "moderate" | "strong";
  dominantTropes: string[];
  positioningNotes: string[];
  marketOpportunity: string[];
  marketRisk: string[];
  findings: FindingDraft[];
};

export type RewritePlanResult = {
  globalStrategy: string;
  preserve: string[];
  change: string[];
  cut: string[];
  moveEarlier: string[];
  intensify: string[];
  chapterPlans: Array<Record<string, unknown>>;
  continuityRules: string[];
  styleRules: string[];
  readerPromise: string;
  marketPositioning: Record<string, unknown>;
};

export type ChapterRewriteResult = {
  rewrittenChapter: string;
  changeLog: Array<Record<string, unknown>>;
  continuityNotes: Record<string, unknown>;
  corpusInfluence?: {
    patternsUsed: string[];
    changed: string[];
    preserved: string[];
    risksIntroduced: string[];
  };
  inventedFactsWarnings: string[];
  nextChapterImplications: string[];
};
