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
  [AnalysisPassType.REWRITE]: "Rewrite"
};
