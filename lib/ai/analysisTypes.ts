export type FindingDraft = {
  issueType: string;
  severity: number;
  confidence: number;
  problem: string;
  evidence?: string;
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
  inventedFactsWarnings: string[];
  nextChapterImplications: string[];
};
