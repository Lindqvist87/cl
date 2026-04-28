import type { AnalysisPassType } from "@prisma/client";

export type JsonRecord = Record<string, unknown>;

export type ParsedParagraph = {
  text: string;
  wordCount: number;
  globalOrder: number;
  chapterOrder: number;
  sceneOrder: number;
  approximateOffset?: number;
};

export type ParsedScene = {
  order: number;
  title: string;
  marker?: string;
  wordCount: number;
  paragraphs: ParsedParagraph[];
};

export type ParsedChapter = {
  order: number;
  title: string;
  heading?: string;
  wordCount: number;
  startOffset?: number;
  endOffset?: number;
  scenes: ParsedScene[];
};

export type ParsedManuscript = {
  title: string;
  normalizedText: string;
  wordCount: number;
  paragraphCount: number;
  chapters: ParsedChapter[];
  metadata: JsonRecord;
};

export type ParsedChunk = {
  chunkIndex: number;
  chapterOrder: number;
  sceneOrder?: number;
  text: string;
  wordCount: number;
  tokenEstimate: number;
  startParagraph: number;
  endParagraph: number;
  metadata: JsonRecord;
};

export type ManuscriptMemory = {
  premise?: string;
  genre?: string;
  targetAudience?: string;
  corePromise?: string;
  characters: Array<{
    name: string;
    role?: string;
    arcNotes?: string;
  }>;
  plotThreads: string[];
  settingNotes: string[];
  styleNotes: string[];
  risks: string[];
  passSummaries: Partial<Record<AnalysisPassType, unknown>>;
};

export type IssueSeverity = "critical" | "high" | "medium" | "low";

export type AuditIssue = {
  title: string;
  severity: IssueSeverity;
  chapter?: string;
  evidence?: string;
  recommendation: string;
};

export type ChapterNote = {
  chapter: string;
  notes: string[];
  priority: IssueSeverity;
};

export type AuditReportJson = {
  executiveSummary: string;
  topIssues: AuditIssue[];
  chapterNotes: ChapterNote[];
  rewriteStrategy: string;
  metadata?: JsonRecord;
};
