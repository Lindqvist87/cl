import { AnalysisPassType } from "@prisma/client";

export const AUDIT_PASSES: AnalysisPassType[] = [
  AnalysisPassType.PREMISE_GENRE,
  AnalysisPassType.STRUCTURE,
  AnalysisPassType.PACING,
  AnalysisPassType.CHARACTER,
  AnalysisPassType.PROSE_STYLE,
  AnalysisPassType.COMMERCIAL_MARKET_FIT
];

export const PASS_LABELS: Record<AnalysisPassType, string> = {
  [AnalysisPassType.PREMISE_GENRE]: "Premise and genre analysis",
  [AnalysisPassType.STRUCTURE]: "Structure analysis",
  [AnalysisPassType.PACING]: "Pacing analysis",
  [AnalysisPassType.CHARACTER]: "Character analysis",
  [AnalysisPassType.PROSE_STYLE]: "Prose/style analysis",
  [AnalysisPassType.COMMERCIAL_MARKET_FIT]: "Commercial/market fit analysis",
  [AnalysisPassType.SYNTHESIS]: "Audit synthesis",
  [AnalysisPassType.REWRITE]: "Rewrite",
  [AnalysisPassType.CHUNK_ANALYSIS]: "Chunk-level manuscript analysis",
  [AnalysisPassType.CHAPTER_AUDIT]: "Chapter audit",
  [AnalysisPassType.WHOLE_BOOK_AUDIT]: "Whole-book audit",
  [AnalysisPassType.CORPUS_COMPARISON]: "Literary corpus comparison",
  [AnalysisPassType.TREND_COMPARISON]: "Trend comparison",
  [AnalysisPassType.REWRITE_PLAN]: "Rewrite plan",
  [AnalysisPassType.CHAPTER_REWRITE]: "Chapter rewrite"
};
