-- Guided corpus onboarding, import progress, and richer Book DNA storage.

ALTER TABLE "CorpusBook"
  ADD COLUMN "sourceName" TEXT,
  ADD COLUMN "fileName" TEXT,
  ADD COLUMN "fileMimeType" TEXT,
  ADD COLUMN "fileFormat" TEXT,
  ADD COLUMN "benchmarkAllowed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "benchmarkReady" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "benchmarkReadyAt" TIMESTAMP(3),
  ADD COLUMN "importProgress" JSONB;

ALTER TABLE "CorpusBookText"
  ADD COLUMN "cleanedAt" TIMESTAMP(3);

ALTER TABLE "CorpusChunk"
  ADD COLUMN "corpusChapterId" TEXT,
  ADD COLUMN "embeddingStatus" TEXT NOT NULL DEFAULT 'PENDING';

ALTER TABLE "BookProfile"
  ADD COLUMN "medianChapterWords" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "minChapterWords" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxChapterWords" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "questionRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "exclamationRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "paragraphLengthDistribution" JSONB,
  ADD COLUMN "sentenceLengthDistribution" JSONB,
  ADD COLUMN "repeatedTerms" JSONB,
  ADD COLUMN "chapterLengthCurve" JSONB,
  ADD COLUMN "dominantSceneModes" JSONB,
  ADD COLUMN "narrativeDistance" TEXT,
  ADD COLUMN "dialogueStyle" JSONB,
  ADD COLUMN "expositionStyle" JSONB,
  ADD COLUMN "literaryCraftLessons" JSONB,
  ADD COLUMN "deterministicMetrics" JSONB,
  ADD COLUMN "aiMetrics" JSONB;

ALTER TABLE "ManuscriptProfile"
  ADD COLUMN "medianChapterWords" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "minChapterWords" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxChapterWords" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "questionRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "exclamationRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "lexicalDensity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "paragraphLengthDistribution" JSONB,
  ADD COLUMN "sentenceLengthDistribution" JSONB,
  ADD COLUMN "repeatedTerms" JSONB,
  ADD COLUMN "chapterLengthCurve" JSONB,
  ADD COLUMN "povEstimate" TEXT,
  ADD COLUMN "tenseEstimate" TEXT,
  ADD COLUMN "openingHookType" TEXT,
  ADD COLUMN "chapterEndingPatterns" JSONB,
  ADD COLUMN "dominantSceneModes" JSONB,
  ADD COLUMN "narrativeDistance" TEXT,
  ADD COLUMN "dialogueStyle" JSONB,
  ADD COLUMN "expositionStyle" JSONB,
  ADD COLUMN "literaryCraftLessons" JSONB,
  ADD COLUMN "deterministicMetrics" JSONB,
  ADD COLUMN "aiMetrics" JSONB;

CREATE TABLE "CorpusChapter" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  "chapterIndex" INTEGER NOT NULL DEFAULT 0,
  "title" TEXT NOT NULL,
  "heading" TEXT,
  "text" TEXT NOT NULL DEFAULT '',
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "startOffset" INTEGER,
  "endOffset" INTEGER,
  "metrics" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CorpusChapter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CorpusImportJob" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "currentStep" TEXT NOT NULL DEFAULT 'uploaded',
  "progress" JSONB,
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CorpusImportJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CorpusChapter_bookId_order_key" ON "CorpusChapter"("bookId", "order");
CREATE INDEX "CorpusChapter_bookId_idx" ON "CorpusChapter"("bookId");
CREATE INDEX "CorpusChapter_bookId_chapterIndex_idx" ON "CorpusChapter"("bookId", "chapterIndex");

CREATE INDEX "CorpusImportJob_bookId_idx" ON "CorpusImportJob"("bookId");
CREATE INDEX "CorpusImportJob_status_idx" ON "CorpusImportJob"("status");
CREATE INDEX "CorpusImportJob_currentStep_idx" ON "CorpusImportJob"("currentStep");
CREATE INDEX "CorpusImportJob_createdAt_idx" ON "CorpusImportJob"("createdAt");

CREATE INDEX "CorpusBook_benchmarkAllowed_idx" ON "CorpusBook"("benchmarkAllowed");
CREATE INDEX "CorpusBook_benchmarkReady_idx" ON "CorpusBook"("benchmarkReady");
CREATE INDEX "CorpusChunk_corpusChapterId_idx" ON "CorpusChunk"("corpusChapterId");
CREATE INDEX "CorpusChunk_embeddingStatus_idx" ON "CorpusChunk"("embeddingStatus");

ALTER TABLE "CorpusChapter"
  ADD CONSTRAINT "CorpusChapter_bookId_fkey"
  FOREIGN KEY ("bookId") REFERENCES "CorpusBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CorpusImportJob"
  ADD CONSTRAINT "CorpusImportJob_bookId_fkey"
  FOREIGN KEY ("bookId") REFERENCES "CorpusBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CorpusChunk"
  ADD CONSTRAINT "CorpusChunk_corpusChapterId_fkey"
  FOREIGN KEY ("corpusChapterId") REFERENCES "CorpusChapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
