CREATE TYPE "EditorialDecisionStatus" AS ENUM ('ACCEPTED', 'REJECTED', 'DEFERRED', 'NEEDS_REVIEW');

CREATE TYPE "EditorialDecisionScope" AS ENUM ('MANUSCRIPT', 'CHAPTER', 'SCENE', 'PARAGRAPH');

CREATE TABLE "EditorialDecision" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "chapterId" TEXT,
  "findingId" TEXT,
  "rewritePlanId" TEXT,
  "title" TEXT NOT NULL,
  "rationale" TEXT,
  "status" "EditorialDecisionStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "scope" "EditorialDecisionScope" NOT NULL DEFAULT 'CHAPTER',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EditorialDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EditorialDecision_manuscriptId_idx" ON "EditorialDecision"("manuscriptId");
CREATE INDEX "EditorialDecision_chapterId_idx" ON "EditorialDecision"("chapterId");
CREATE INDEX "EditorialDecision_findingId_idx" ON "EditorialDecision"("findingId");
CREATE INDEX "EditorialDecision_rewritePlanId_idx" ON "EditorialDecision"("rewritePlanId");
CREATE INDEX "EditorialDecision_status_idx" ON "EditorialDecision"("status");
CREATE INDEX "EditorialDecision_scope_idx" ON "EditorialDecision"("scope");

ALTER TABLE "EditorialDecision"
  ADD CONSTRAINT "EditorialDecision_manuscriptId_fkey"
  FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EditorialDecision"
  ADD CONSTRAINT "EditorialDecision_chapterId_fkey"
  FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EditorialDecision"
  ADD CONSTRAINT "EditorialDecision_findingId_fkey"
  FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EditorialDecision"
  ADD CONSTRAINT "EditorialDecision_rewritePlanId_fkey"
  FOREIGN KEY ("rewritePlanId") REFERENCES "RewritePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
