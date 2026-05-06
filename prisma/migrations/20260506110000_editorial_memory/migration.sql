CREATE TYPE "EditorialMemoryStatus" AS ENUM ('ACTIVE', 'STALE', 'NEEDS_REANCHOR', 'SUPERSEDED');
CREATE TYPE "AnalysisSnapshotStatus" AS ENUM ('LOCKED', 'SUPERSEDED');

CREATE TABLE "AnalysisSnapshot" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "documentRevision" INTEGER NOT NULL DEFAULT 0,
  "textHash" TEXT NOT NULL,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "sourceFileName" TEXT NOT NULL,
  "sourceMimeType" TEXT,
  "sourceFormat" "ManuscriptFormat",
  "sourceText" TEXT NOT NULL,
  "metadata" JSONB,
  "status" "AnalysisSnapshotStatus" NOT NULL DEFAULT 'LOCKED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AnalysisSnapshot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AnalysisRun" ADD COLUMN "snapshotId" TEXT;
ALTER TABLE "AnalysisOutput" ADD COLUMN "snapshotId" TEXT;
ALTER TABLE "AuditReport" ADD COLUMN "snapshotId" TEXT;
ALTER TABLE "Finding" ADD COLUMN "snapshotId" TEXT;
ALTER TABLE "RewritePlan" ADD COLUMN "snapshotId" TEXT;
ALTER TABLE "CompilerArtifact" ADD COLUMN "snapshotId" TEXT;
ALTER TABLE "PipelineJob" ADD COLUMN "snapshotId" TEXT;

CREATE TABLE "EditorialMemoryItem" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT,
  "content" TEXT NOT NULL,
  "status" "EditorialMemoryStatus" NOT NULL DEFAULT 'ACTIVE',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "supersededById" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EditorialMemoryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EditorialMemorySource" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "analysisRunId" TEXT,
  "analysisOutputId" TEXT,
  "snapshotId" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "promptVersion" TEXT,
  "model" TEXT,
  "rawOutputHash" TEXT,
  "rawOutput" JSONB,
  "provenance" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EditorialMemorySource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EditorialMemoryAnchor" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "nodeId" TEXT,
  "chapterId" TEXT,
  "sceneId" TEXT,
  "chunkId" TEXT,
  "paragraphStart" INTEGER,
  "paragraphEnd" INTEGER,
  "startOffset" INTEGER,
  "endOffset" INTEGER,
  "textHash" TEXT,
  "revision" INTEGER,
  "sourceTextSnippet" TEXT,
  "status" "EditorialMemoryStatus" NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EditorialMemoryAnchor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EditorialMemoryRevision" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "analysisRunId" TEXT,
  "snapshotId" TEXT,
  "fromStatus" "EditorialMemoryStatus",
  "toStatus" "EditorialMemoryStatus" NOT NULL,
  "reason" TEXT NOT NULL,
  "previousValue" JSONB,
  "nextValue" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EditorialMemoryRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EditorialMemoryItem_manuscriptId_key_key" ON "EditorialMemoryItem"("manuscriptId", "key");
CREATE UNIQUE INDEX "AnalysisSnapshot_manuscriptId_textHash_documentRevision_key" ON "AnalysisSnapshot"("manuscriptId", "textHash", "documentRevision");
CREATE INDEX "AnalysisSnapshot_manuscriptId_idx" ON "AnalysisSnapshot"("manuscriptId");
CREATE INDEX "AnalysisSnapshot_textHash_idx" ON "AnalysisSnapshot"("textHash");
CREATE INDEX "AnalysisSnapshot_status_idx" ON "AnalysisSnapshot"("status");
CREATE INDEX "AnalysisSnapshot_createdAt_idx" ON "AnalysisSnapshot"("createdAt");
CREATE INDEX "AnalysisRun_snapshotId_idx" ON "AnalysisRun"("snapshotId");
CREATE INDEX "AnalysisOutput_snapshotId_idx" ON "AnalysisOutput"("snapshotId");
CREATE INDEX "AuditReport_snapshotId_idx" ON "AuditReport"("snapshotId");
CREATE INDEX "Finding_snapshotId_idx" ON "Finding"("snapshotId");
CREATE INDEX "RewritePlan_snapshotId_idx" ON "RewritePlan"("snapshotId");
CREATE INDEX "CompilerArtifact_snapshotId_idx" ON "CompilerArtifact"("snapshotId");
CREATE INDEX "PipelineJob_snapshotId_idx" ON "PipelineJob"("snapshotId");
CREATE INDEX "EditorialMemoryItem_manuscriptId_idx" ON "EditorialMemoryItem"("manuscriptId");
CREATE INDEX "EditorialMemoryItem_status_idx" ON "EditorialMemoryItem"("status");
CREATE INDEX "EditorialMemoryItem_type_idx" ON "EditorialMemoryItem"("type");
CREATE INDEX "EditorialMemoryItem_supersededById_idx" ON "EditorialMemoryItem"("supersededById");
CREATE INDEX "EditorialMemoryItem_manuscriptId_status_idx" ON "EditorialMemoryItem"("manuscriptId", "status");
CREATE INDEX "EditorialMemoryItem_manuscriptId_type_idx" ON "EditorialMemoryItem"("manuscriptId", "type");

CREATE INDEX "EditorialMemorySource_itemId_idx" ON "EditorialMemorySource"("itemId");
CREATE INDEX "EditorialMemorySource_manuscriptId_idx" ON "EditorialMemorySource"("manuscriptId");
CREATE INDEX "EditorialMemorySource_analysisRunId_idx" ON "EditorialMemorySource"("analysisRunId");
CREATE INDEX "EditorialMemorySource_analysisOutputId_idx" ON "EditorialMemorySource"("analysisOutputId");
CREATE INDEX "EditorialMemorySource_snapshotId_idx" ON "EditorialMemorySource"("snapshotId");
CREATE INDEX "EditorialMemorySource_sourceType_idx" ON "EditorialMemorySource"("sourceType");
CREATE INDEX "EditorialMemorySource_rawOutputHash_idx" ON "EditorialMemorySource"("rawOutputHash");

CREATE INDEX "EditorialMemoryAnchor_itemId_idx" ON "EditorialMemoryAnchor"("itemId");
CREATE INDEX "EditorialMemoryAnchor_manuscriptId_idx" ON "EditorialMemoryAnchor"("manuscriptId");
CREATE INDEX "EditorialMemoryAnchor_nodeId_idx" ON "EditorialMemoryAnchor"("nodeId");
CREATE INDEX "EditorialMemoryAnchor_chapterId_idx" ON "EditorialMemoryAnchor"("chapterId");
CREATE INDEX "EditorialMemoryAnchor_sceneId_idx" ON "EditorialMemoryAnchor"("sceneId");
CREATE INDEX "EditorialMemoryAnchor_chunkId_idx" ON "EditorialMemoryAnchor"("chunkId");
CREATE INDEX "EditorialMemoryAnchor_textHash_idx" ON "EditorialMemoryAnchor"("textHash");
CREATE INDEX "EditorialMemoryAnchor_status_idx" ON "EditorialMemoryAnchor"("status");
CREATE INDEX "EditorialMemoryAnchor_manuscriptId_status_idx" ON "EditorialMemoryAnchor"("manuscriptId", "status");

CREATE INDEX "EditorialMemoryRevision_itemId_idx" ON "EditorialMemoryRevision"("itemId");
CREATE INDEX "EditorialMemoryRevision_manuscriptId_idx" ON "EditorialMemoryRevision"("manuscriptId");
CREATE INDEX "EditorialMemoryRevision_analysisRunId_idx" ON "EditorialMemoryRevision"("analysisRunId");
CREATE INDEX "EditorialMemoryRevision_snapshotId_idx" ON "EditorialMemoryRevision"("snapshotId");
CREATE INDEX "EditorialMemoryRevision_toStatus_idx" ON "EditorialMemoryRevision"("toStatus");
CREATE INDEX "EditorialMemoryRevision_createdAt_idx" ON "EditorialMemoryRevision"("createdAt");

ALTER TABLE "AnalysisSnapshot" ADD CONSTRAINT "AnalysisSnapshot_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AnalysisSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnalysisOutput" ADD CONSTRAINT "AnalysisOutput_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AnalysisSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditReport" ADD CONSTRAINT "AuditReport_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AnalysisSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AnalysisSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RewritePlan" ADD CONSTRAINT "RewritePlan_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AnalysisSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompilerArtifact" ADD CONSTRAINT "CompilerArtifact_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AnalysisSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PipelineJob" ADD CONSTRAINT "PipelineJob_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AnalysisSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EditorialMemoryItem" ADD CONSTRAINT "EditorialMemoryItem_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditorialMemoryItem" ADD CONSTRAINT "EditorialMemoryItem_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "EditorialMemoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EditorialMemorySource" ADD CONSTRAINT "EditorialMemorySource_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "EditorialMemoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditorialMemorySource" ADD CONSTRAINT "EditorialMemorySource_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditorialMemorySource" ADD CONSTRAINT "EditorialMemorySource_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EditorialMemorySource" ADD CONSTRAINT "EditorialMemorySource_analysisOutputId_fkey" FOREIGN KEY ("analysisOutputId") REFERENCES "AnalysisOutput"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EditorialMemorySource" ADD CONSTRAINT "EditorialMemorySource_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AnalysisSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EditorialMemoryAnchor" ADD CONSTRAINT "EditorialMemoryAnchor_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "EditorialMemoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditorialMemoryAnchor" ADD CONSTRAINT "EditorialMemoryAnchor_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditorialMemoryRevision" ADD CONSTRAINT "EditorialMemoryRevision_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "EditorialMemoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditorialMemoryRevision" ADD CONSTRAINT "EditorialMemoryRevision_manuscriptId_fkey" FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditorialMemoryRevision" ADD CONSTRAINT "EditorialMemoryRevision_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EditorialMemoryRevision" ADD CONSTRAINT "EditorialMemoryRevision_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AnalysisSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
