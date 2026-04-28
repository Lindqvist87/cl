CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "ManuscriptFormat" AS ENUM ('TXT', 'DOCX');
CREATE TYPE "AnalysisStatus" AS ENUM ('NOT_STARTED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "AnalysisRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "AnalysisOutputStatus" AS ENUM ('COMPLETED', 'FAILED');
CREATE TYPE "AnalysisPassType" AS ENUM ('PREMISE_GENRE', 'STRUCTURE', 'PACING', 'CHARACTER', 'PROSE_STYLE', 'COMMERCIAL_MARKET_FIT', 'SYNTHESIS', 'REWRITE');

CREATE TABLE "Manuscript" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "sourceFileName" TEXT NOT NULL,
  "sourceMimeType" TEXT,
  "sourceFormat" "ManuscriptFormat" NOT NULL,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "chapterCount" INTEGER NOT NULL DEFAULT 0,
  "paragraphCount" INTEGER NOT NULL DEFAULT 0,
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "analysisStatus" "AnalysisStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Manuscript_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManuscriptVersion" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "sourceText" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "parserVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManuscriptVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Chapter" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "heading" TEXT,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "startOffset" INTEGER,
  "endOffset" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Scene" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "marker" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Paragraph" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL,
  "sceneId" TEXT NOT NULL,
  "globalOrder" INTEGER NOT NULL,
  "chapterOrder" INTEGER NOT NULL,
  "sceneOrder" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "approximateOffset" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Paragraph_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManuscriptChunk" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL,
  "sceneId" TEXT,
  "chunkIndex" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "startParagraph" INTEGER NOT NULL,
  "endParagraph" INTEGER NOT NULL,
  "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "embedding" vector(1536),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManuscriptChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalysisRun" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "status" "AnalysisRunStatus" NOT NULL DEFAULT 'RUNNING',
  "currentPass" "AnalysisPassType",
  "globalMemory" JSONB,
  "checkpoint" JSONB,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalysisOutput" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "passType" "AnalysisPassType" NOT NULL,
  "scopeType" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "chunkId" TEXT,
  "chapterId" TEXT,
  "promptVersion" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputSummary" JSONB,
  "output" JSONB NOT NULL,
  "rawText" TEXT,
  "status" "AnalysisOutputStatus" NOT NULL DEFAULT 'COMPLETED',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalysisOutput_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditReport" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "executiveSummary" TEXT NOT NULL,
  "topIssues" JSONB NOT NULL,
  "chapterNotes" JSONB NOT NULL,
  "rewriteStrategy" TEXT NOT NULL,
  "structured" JSONB NOT NULL,
  "markdown" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuditReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChapterRewrite" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL,
  "runId" TEXT,
  "promptVersion" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "sourceSummary" JSONB,
  "content" TEXT NOT NULL,
  "rationale" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChapterRewrite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Manuscript_createdAt_idx" ON "Manuscript"("createdAt");
CREATE INDEX "Manuscript_analysisStatus_idx" ON "Manuscript"("analysisStatus");
CREATE UNIQUE INDEX "ManuscriptVersion_manuscriptId_versionNumber_key" ON "ManuscriptVersion"("manuscriptId", "versionNumber");
CREATE INDEX "ManuscriptVersion_sourceHash_idx" ON "ManuscriptVersion"("sourceHash");
CREATE UNIQUE INDEX "Chapter_manuscriptId_order_key" ON "Chapter"("manuscriptId", "order");
CREATE INDEX "Chapter_manuscriptId_idx" ON "Chapter"("manuscriptId");
CREATE UNIQUE INDEX "Scene_chapterId_order_key" ON "Scene"("chapterId", "order");
CREATE INDEX "Scene_manuscriptId_idx" ON "Scene"("manuscriptId");
CREATE UNIQUE INDEX "Paragraph_manuscriptId_globalOrder_key" ON "Paragraph"("manuscriptId", "globalOrder");
CREATE INDEX "Paragraph_chapterId_idx" ON "Paragraph"("chapterId");
CREATE INDEX "Paragraph_sceneId_idx" ON "Paragraph"("sceneId");
CREATE UNIQUE INDEX "ManuscriptChunk_manuscriptId_chunkIndex_key" ON "ManuscriptChunk"("manuscriptId", "chunkIndex");
CREATE INDEX "ManuscriptChunk_manuscriptId_idx" ON "ManuscriptChunk"("manuscriptId");
CREATE INDEX "ManuscriptChunk_chapterId_idx" ON "ManuscriptChunk"("chapterId");
CREATE INDEX "AnalysisRun_manuscriptId_status_idx" ON "AnalysisRun"("manuscriptId", "status");
CREATE UNIQUE INDEX "AnalysisOutput_runId_passType_scopeType_scopeId_key" ON "AnalysisOutput"("runId", "passType", "scopeType", "scopeId");
CREATE INDEX "AnalysisOutput_manuscriptId_passType_idx" ON "AnalysisOutput"("manuscriptId", "passType");
CREATE INDEX "AnalysisOutput_chunkId_idx" ON "AnalysisOutput"("chunkId");
CREATE UNIQUE INDEX "AuditReport_runId_key" ON "AuditReport"("runId");
CREATE INDEX "AuditReport_manuscriptId_idx" ON "AuditReport"("manuscriptId");
CREATE INDEX "ChapterRewrite_manuscriptId_idx" ON "ChapterRewrite"("manuscriptId");
CREATE INDEX "ChapterRewrite_chapterId_idx" ON "ChapterRewrite"("chapterId");

ALTER TABLE "ManuscriptVersion" ADD CONSTRAINT "ManuscriptVersion_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Paragraph" ADD CONSTRAINT "Paragraph_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Paragraph" ADD CONSTRAINT "Paragraph_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Paragraph" ADD CONSTRAINT "Paragraph_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManuscriptChunk" ADD CONSTRAINT "ManuscriptChunk_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManuscriptChunk" ADD CONSTRAINT "ManuscriptChunk_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManuscriptChunk" ADD CONSTRAINT "ManuscriptChunk_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalysisOutput" ADD CONSTRAINT "AnalysisOutput_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalysisOutput" ADD CONSTRAINT "AnalysisOutput_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalysisOutput" ADD CONSTRAINT "AnalysisOutput_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "ManuscriptChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditReport" ADD CONSTRAINT "AuditReport_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditReport" ADD CONSTRAINT "AuditReport_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChapterRewrite" ADD CONSTRAINT "ChapterRewrite_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChapterRewrite" ADD CONSTRAINT "ChapterRewrite_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChapterRewrite" ADD CONSTRAINT "ChapterRewrite_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
