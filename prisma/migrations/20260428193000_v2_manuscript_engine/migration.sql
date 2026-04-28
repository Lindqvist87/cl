CREATE TYPE "AnalysisRunType" AS ENUM (
  'FULL_AUDIT',
  'CHAPTER_AUDIT',
  'CORPUS_COMPARISON',
  'TREND_COMPARISON',
  'REWRITE_PLAN',
  'CHAPTER_REWRITE'
);

CREATE TYPE "SourceType" AS ENUM (
  'GUTENBERG',
  'LITTERATURBANKEN',
  'SPRAKBANKEN',
  'DOAB',
  'GOOGLE_BOOKS',
  'NYT_BOOKS',
  'MANUAL',
  'PRIVATE'
);

CREATE TYPE "RightsStatus" AS ENUM (
  'PUBLIC_DOMAIN',
  'OPEN_LICENSE',
  'LICENSED',
  'PRIVATE_REFERENCE',
  'METADATA_ONLY',
  'UNKNOWN'
);

CREATE TYPE "CorpusIngestionStatus" AS ENUM (
  'QUEUED',
  'IMPORTED',
  'CHUNKED',
  'PROFILED',
  'FAILED',
  'METADATA_ONLY'
);

CREATE TYPE "CorpusAnalysisStatus" AS ENUM (
  'NOT_STARTED',
  'RUNNING',
  'COMPLETED',
  'FAILED'
);

ALTER TYPE "AnalysisRunStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "AnalysisPassType" ADD VALUE IF NOT EXISTS 'CHUNK_ANALYSIS';
ALTER TYPE "AnalysisPassType" ADD VALUE IF NOT EXISTS 'CHAPTER_AUDIT';
ALTER TYPE "AnalysisPassType" ADD VALUE IF NOT EXISTS 'WHOLE_BOOK_AUDIT';
ALTER TYPE "AnalysisPassType" ADD VALUE IF NOT EXISTS 'CORPUS_COMPARISON';
ALTER TYPE "AnalysisPassType" ADD VALUE IF NOT EXISTS 'TREND_COMPARISON';
ALTER TYPE "AnalysisPassType" ADD VALUE IF NOT EXISTS 'REWRITE_PLAN';
ALTER TYPE "AnalysisPassType" ADD VALUE IF NOT EXISTS 'CHAPTER_REWRITE';

ALTER TABLE "Manuscript"
  ADD COLUMN "authorName" TEXT,
  ADD COLUMN "targetGenre" TEXT,
  ADD COLUMN "targetAudience" TEXT,
  ADD COLUMN "originalFileUrl" TEXT,
  ADD COLUMN "originalText" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'UPLOADED';

UPDATE "Manuscript" AS m
SET "originalText" = v."sourceText"
FROM "ManuscriptVersion" AS v
WHERE v."manuscriptId" = m."id"
  AND v."versionNumber" = 1
  AND m."originalText" IS NULL;

ALTER TABLE "Chapter"
  ADD COLUMN "chapterIndex" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "text" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';

UPDATE "Chapter" SET "chapterIndex" = "order" WHERE "chapterIndex" = 0;

ALTER TABLE "ManuscriptChunk"
  ADD COLUMN "paragraphStart" INTEGER,
  ADD COLUMN "paragraphEnd" INTEGER,
  ADD COLUMN "tokenCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "localMetrics" JSONB,
  ADD COLUMN "summary" TEXT;

UPDATE "ManuscriptChunk"
SET
  "paragraphStart" = "startParagraph",
  "paragraphEnd" = "endParagraph",
  "tokenCount" = "tokenEstimate"
WHERE "paragraphStart" IS NULL OR "paragraphEnd" IS NULL OR "tokenCount" = 0;

ALTER TABLE "AnalysisRun"
  ADD COLUMN "type" "AnalysisRunType" NOT NULL DEFAULT 'FULL_AUDIT',
  ADD COLUMN "model" TEXT,
  ADD COLUMN "metadata" JSONB;

ALTER TABLE "ChapterRewrite"
  ADD COLUMN "rewritePlanId" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "originalText" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "rewrittenText" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "changeLog" JSONB,
  ADD COLUMN "continuityNotes" JSONB,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT';

UPDATE "ChapterRewrite"
SET
  "rewrittenText" = CASE WHEN "rewrittenText" = '' THEN "content" ELSE "rewrittenText" END,
  "originalText" = CASE WHEN "originalText" = '' THEN COALESCE((
    SELECT "text" FROM "Chapter" WHERE "Chapter"."id" = "ChapterRewrite"."chapterId"
  ), '') ELSE "originalText" END;

CREATE TABLE "Source" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "SourceType" NOT NULL,
  "baseUrl" TEXT,
  "rightsNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CorpusBook" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "author" TEXT,
  "language" TEXT,
  "publicationYear" INTEGER,
  "genre" TEXT,
  "sourceUrl" TEXT,
  "rightsStatus" "RightsStatus" NOT NULL DEFAULT 'UNKNOWN',
  "licenseType" TEXT,
  "allowedUses" JSONB,
  "fullTextAvailable" BOOLEAN NOT NULL DEFAULT false,
  "ingestionStatus" "CorpusIngestionStatus" NOT NULL DEFAULT 'QUEUED',
  "analysisStatus" "CorpusAnalysisStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorpusBook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CorpusBookText" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "rawText" TEXT NOT NULL,
  "cleanedText" TEXT NOT NULL,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorpusBookText_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CorpusChunk" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "chapterIndex" INTEGER,
  "sectionIndex" INTEGER,
  "paragraphIndex" INTEGER,
  "chunkIndex" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "tokenCount" INTEGER NOT NULL DEFAULT 0,
  "embedding" vector(1536),
  "summary" TEXT,
  "metrics" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorpusChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BookProfile" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "chapterCount" INTEGER NOT NULL DEFAULT 0,
  "avgChapterWords" INTEGER NOT NULL DEFAULT 0,
  "avgSentenceLength" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "dialogueRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expositionRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "actionRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "introspectionRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lexicalDensity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "povEstimate" TEXT,
  "tenseEstimate" TEXT,
  "openingHookType" TEXT,
  "pacingCurve" JSONB,
  "emotionalIntensityCurve" JSONB,
  "conflictDensityCurve" JSONB,
  "chapterEndingPatterns" JSONB,
  "styleFingerprint" JSONB,
  "genreMarkers" JSONB,
  "tropeMarkers" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrendSignal" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "title" TEXT,
  "author" TEXT,
  "genre" TEXT,
  "category" TEXT,
  "rank" INTEGER,
  "listName" TEXT,
  "signalDate" TIMESTAMP(3),
  "description" TEXT,
  "blurb" TEXT,
  "reviewSnippet" TEXT,
  "externalUrl" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrendSignal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManuscriptProfile" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "chapterCount" INTEGER NOT NULL DEFAULT 0,
  "avgChapterWords" INTEGER NOT NULL DEFAULT 0,
  "avgSentenceLength" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "dialogueRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expositionRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "actionRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "introspectionRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "pacingCurve" JSONB,
  "emotionalIntensityCurve" JSONB,
  "conflictDensityCurve" JSONB,
  "styleFingerprint" JSONB,
  "genreMarkers" JSONB,
  "tropeMarkers" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManuscriptProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Finding" (
  "id" TEXT NOT NULL,
  "analysisRunId" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "chapterId" TEXT,
  "chunkId" TEXT,
  "issueType" TEXT NOT NULL,
  "severity" INTEGER NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "problem" TEXT NOT NULL,
  "evidence" TEXT,
  "recommendation" TEXT NOT NULL,
  "rewriteInstruction" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RewritePlan" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "analysisRunId" TEXT NOT NULL,
  "globalStrategy" TEXT NOT NULL,
  "chapterPlans" JSONB NOT NULL,
  "continuityRules" JSONB NOT NULL,
  "styleRules" JSONB NOT NULL,
  "marketPositioning" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewritePlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Source_type_idx" ON "Source"("type");
CREATE INDEX "CorpusBook_sourceId_idx" ON "CorpusBook"("sourceId");
CREATE INDEX "CorpusBook_rightsStatus_idx" ON "CorpusBook"("rightsStatus");
CREATE INDEX "CorpusBook_ingestionStatus_idx" ON "CorpusBook"("ingestionStatus");
CREATE INDEX "CorpusBook_analysisStatus_idx" ON "CorpusBook"("analysisStatus");
CREATE INDEX "CorpusBook_genre_idx" ON "CorpusBook"("genre");
CREATE INDEX "CorpusBook_language_idx" ON "CorpusBook"("language");
CREATE UNIQUE INDEX "CorpusBookText_bookId_key" ON "CorpusBookText"("bookId");
CREATE UNIQUE INDEX "CorpusChunk_bookId_chunkIndex_key" ON "CorpusChunk"("bookId", "chunkIndex");
CREATE INDEX "CorpusChunk_bookId_idx" ON "CorpusChunk"("bookId");
CREATE INDEX "CorpusChunk_chapterIndex_idx" ON "CorpusChunk"("chapterIndex");
CREATE UNIQUE INDEX "BookProfile_bookId_key" ON "BookProfile"("bookId");
CREATE INDEX "TrendSignal_source_idx" ON "TrendSignal"("source");
CREATE INDEX "TrendSignal_genre_idx" ON "TrendSignal"("genre");
CREATE INDEX "TrendSignal_category_idx" ON "TrendSignal"("category");
CREATE INDEX "TrendSignal_signalDate_idx" ON "TrendSignal"("signalDate");
CREATE INDEX "TrendSignal_rank_idx" ON "TrendSignal"("rank");
CREATE INDEX "Manuscript_status_idx" ON "Manuscript"("status");
CREATE INDEX "Manuscript_targetGenre_idx" ON "Manuscript"("targetGenre");
CREATE INDEX "Chapter_manuscriptId_chapterIndex_idx" ON "Chapter"("manuscriptId", "chapterIndex");
CREATE INDEX "Chapter_status_idx" ON "Chapter"("status");
CREATE UNIQUE INDEX "ManuscriptProfile_manuscriptId_key" ON "ManuscriptProfile"("manuscriptId");
CREATE INDEX "AnalysisRun_manuscriptId_type_idx" ON "AnalysisRun"("manuscriptId", "type");
CREATE INDEX "Finding_analysisRunId_idx" ON "Finding"("analysisRunId");
CREATE INDEX "Finding_manuscriptId_idx" ON "Finding"("manuscriptId");
CREATE INDEX "Finding_chapterId_idx" ON "Finding"("chapterId");
CREATE INDEX "Finding_chunkId_idx" ON "Finding"("chunkId");
CREATE INDEX "Finding_issueType_idx" ON "Finding"("issueType");
CREATE INDEX "Finding_severity_idx" ON "Finding"("severity");
CREATE INDEX "RewritePlan_manuscriptId_idx" ON "RewritePlan"("manuscriptId");
CREATE INDEX "RewritePlan_analysisRunId_idx" ON "RewritePlan"("analysisRunId");
CREATE INDEX "ChapterRewrite_rewritePlanId_idx" ON "ChapterRewrite"("rewritePlanId");
CREATE INDEX "ChapterRewrite_status_idx" ON "ChapterRewrite"("status");

ALTER TABLE "CorpusBook" ADD CONSTRAINT "CorpusBook_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorpusBookText" ADD CONSTRAINT "CorpusBookText_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "CorpusBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorpusChunk" ADD CONSTRAINT "CorpusChunk_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "CorpusBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookProfile" ADD CONSTRAINT "BookProfile_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "CorpusBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManuscriptProfile" ADD CONSTRAINT "ManuscriptProfile_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "ManuscriptChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RewritePlan" ADD CONSTRAINT "RewritePlan_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RewritePlan" ADD CONSTRAINT "RewritePlan_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChapterRewrite" ADD CONSTRAINT "ChapterRewrite_rewritePlanId_fkey" FOREIGN KEY ("rewritePlanId") REFERENCES "RewritePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
