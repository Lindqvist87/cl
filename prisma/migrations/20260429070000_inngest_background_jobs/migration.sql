CREATE TABLE "PipelineJob" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT,
  "chapterId" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "idempotencyKey" TEXT NOT NULL,
  "dependencyIds" JSONB,
  "readyAt" TIMESTAMP(3),
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lockExpiresAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "error" TEXT,
  "metadata" JSONB,
  "result" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PipelineJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InngestEventLog" (
  "id" TEXT NOT NULL,
  "eventName" TEXT NOT NULL,
  "manuscriptId" TEXT,
  "jobId" TEXT,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SENT',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InngestEventLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkerHeartbeat" (
  "id" TEXT NOT NULL,
  "workerType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PipelineJob_idempotencyKey_key" ON "PipelineJob"("idempotencyKey");
CREATE INDEX "PipelineJob_manuscriptId_idx" ON "PipelineJob"("manuscriptId");
CREATE INDEX "PipelineJob_chapterId_idx" ON "PipelineJob"("chapterId");
CREATE INDEX "PipelineJob_type_idx" ON "PipelineJob"("type");
CREATE INDEX "PipelineJob_status_idx" ON "PipelineJob"("status");
CREATE INDEX "PipelineJob_readyAt_idx" ON "PipelineJob"("readyAt");
CREATE INDEX "PipelineJob_lockedAt_idx" ON "PipelineJob"("lockedAt");
CREATE INDEX "PipelineJob_lockExpiresAt_idx" ON "PipelineJob"("lockExpiresAt");
CREATE INDEX "PipelineJob_manuscriptId_status_idx" ON "PipelineJob"("manuscriptId", "status");

CREATE INDEX "InngestEventLog_eventName_idx" ON "InngestEventLog"("eventName");
CREATE INDEX "InngestEventLog_manuscriptId_idx" ON "InngestEventLog"("manuscriptId");
CREATE INDEX "InngestEventLog_jobId_idx" ON "InngestEventLog"("jobId");
CREATE INDEX "InngestEventLog_status_idx" ON "InngestEventLog"("status");
CREATE INDEX "InngestEventLog_createdAt_idx" ON "InngestEventLog"("createdAt");

CREATE UNIQUE INDEX "WorkerHeartbeat_workerType_key" ON "WorkerHeartbeat"("workerType");
CREATE INDEX "WorkerHeartbeat_status_idx" ON "WorkerHeartbeat"("status");
CREATE INDEX "WorkerHeartbeat_lastSeenAt_idx" ON "WorkerHeartbeat"("lastSeenAt");

ALTER TABLE "PipelineJob"
  ADD CONSTRAINT "PipelineJob_manuscriptId_fkey"
  FOREIGN KEY ("manuscriptId") REFERENCES "Manuscript"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
