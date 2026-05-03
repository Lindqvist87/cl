CREATE TABLE "ManuscriptNode" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "parentId" TEXT,
  "key" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  "title" TEXT,
  "chapterId" TEXT,
  "sceneId" TEXT,
  "chunkId" TEXT,
  "paragraphStart" INTEGER,
  "paragraphEnd" INTEGER,
  "textHash" TEXT,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "summaryShort" TEXT,
  "summaryLong" TEXT,
  "metrics" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ManuscriptNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompilerArtifact" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "nodeId" TEXT,
  "chapterId" TEXT,
  "sceneId" TEXT,
  "chunkId" TEXT,
  "artifactType" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "reasoningEffort" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "output" JSONB NOT NULL,
  "rawText" TEXT,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompilerArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NarrativeFact" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "nodeId" TEXT,
  "chapterId" TEXT,
  "sceneId" TEXT,
  "factType" TEXT NOT NULL,
  "subject" TEXT,
  "predicate" TEXT,
  "object" TEXT,
  "factText" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "sourceTextSnippet" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NarrativeFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CharacterState" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "nodeId" TEXT,
  "chapterId" TEXT,
  "sceneId" TEXT,
  "characterName" TEXT NOT NULL,
  "canonicalName" TEXT,
  "goals" JSONB,
  "fears" JSONB,
  "knowledge" JSONB,
  "secrets" JSONB,
  "relationships" JSONB,
  "emotionalState" TEXT,
  "deltaFromPrevious" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CharacterState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlotEvent" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "nodeId" TEXT,
  "chapterId" TEXT,
  "sceneId" TEXT,
  "eventText" TEXT NOT NULL,
  "cause" TEXT,
  "consequence" TEXT,
  "opensThread" TEXT,
  "closesThread" TEXT,
  "stakes" TEXT,
  "affectedCharacters" JSONB,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlotEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StyleFingerprint" (
  "id" TEXT NOT NULL,
  "manuscriptId" TEXT NOT NULL,
  "nodeId" TEXT,
  "chapterId" TEXT,
  "sceneId" TEXT,
  "scopeType" TEXT NOT NULL,
  "povEstimate" TEXT,
  "tenseEstimate" TEXT,
  "narrativeDistance" TEXT,
  "dialogueRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgSentenceLength" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "dominantModes" JSONB,
  "voiceRules" JSONB,
  "metrics" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StyleFingerprint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManuscriptNode_key_key" ON "ManuscriptNode"("key");
CREATE INDEX "ManuscriptNode_manuscriptId_idx" ON "ManuscriptNode"("manuscriptId");
CREATE INDEX "ManuscriptNode_parentId_idx" ON "ManuscriptNode"("parentId");
CREATE INDEX "ManuscriptNode_type_idx" ON "ManuscriptNode"("type");
CREATE INDEX "ManuscriptNode_chapterId_idx" ON "ManuscriptNode"("chapterId");
CREATE INDEX "ManuscriptNode_sceneId_idx" ON "ManuscriptNode"("sceneId");
CREATE INDEX "ManuscriptNode_chunkId_idx" ON "ManuscriptNode"("chunkId");
CREATE INDEX "ManuscriptNode_manuscriptId_type_idx" ON "ManuscriptNode"("manuscriptId", "type");
CREATE INDEX "ManuscriptNode_manuscriptId_order_idx" ON "ManuscriptNode"("manuscriptId", "order");

CREATE UNIQUE INDEX "CompilerArtifact_manuscriptId_artifactType_inputHash_key" ON "CompilerArtifact"("manuscriptId", "artifactType", "inputHash");
CREATE INDEX "CompilerArtifact_manuscriptId_idx" ON "CompilerArtifact"("manuscriptId");
CREATE INDEX "CompilerArtifact_nodeId_idx" ON "CompilerArtifact"("nodeId");
CREATE INDEX "CompilerArtifact_chapterId_idx" ON "CompilerArtifact"("chapterId");
CREATE INDEX "CompilerArtifact_sceneId_idx" ON "CompilerArtifact"("sceneId");
CREATE INDEX "CompilerArtifact_chunkId_idx" ON "CompilerArtifact"("chunkId");
CREATE INDEX "CompilerArtifact_artifactType_idx" ON "CompilerArtifact"("artifactType");
CREATE INDEX "CompilerArtifact_manuscriptId_artifactType_idx" ON "CompilerArtifact"("manuscriptId", "artifactType");
CREATE INDEX "CompilerArtifact_inputHash_idx" ON "CompilerArtifact"("inputHash");

CREATE INDEX "NarrativeFact_manuscriptId_idx" ON "NarrativeFact"("manuscriptId");
CREATE INDEX "NarrativeFact_nodeId_idx" ON "NarrativeFact"("nodeId");
CREATE INDEX "NarrativeFact_chapterId_idx" ON "NarrativeFact"("chapterId");
CREATE INDEX "NarrativeFact_sceneId_idx" ON "NarrativeFact"("sceneId");
CREATE INDEX "NarrativeFact_factType_idx" ON "NarrativeFact"("factType");
CREATE INDEX "NarrativeFact_subject_idx" ON "NarrativeFact"("subject");
CREATE INDEX "NarrativeFact_status_idx" ON "NarrativeFact"("status");

CREATE INDEX "CharacterState_manuscriptId_idx" ON "CharacterState"("manuscriptId");
CREATE INDEX "CharacterState_canonicalName_idx" ON "CharacterState"("canonicalName");
CREATE INDEX "CharacterState_characterName_idx" ON "CharacterState"("characterName");
CREATE INDEX "CharacterState_chapterId_idx" ON "CharacterState"("chapterId");
CREATE INDEX "CharacterState_sceneId_idx" ON "CharacterState"("sceneId");
CREATE INDEX "CharacterState_nodeId_idx" ON "CharacterState"("nodeId");

CREATE INDEX "PlotEvent_manuscriptId_idx" ON "PlotEvent"("manuscriptId");
CREATE INDEX "PlotEvent_chapterId_idx" ON "PlotEvent"("chapterId");
CREATE INDEX "PlotEvent_sceneId_idx" ON "PlotEvent"("sceneId");
CREATE INDEX "PlotEvent_nodeId_idx" ON "PlotEvent"("nodeId");

CREATE INDEX "StyleFingerprint_manuscriptId_idx" ON "StyleFingerprint"("manuscriptId");
CREATE INDEX "StyleFingerprint_nodeId_idx" ON "StyleFingerprint"("nodeId");
CREATE INDEX "StyleFingerprint_chapterId_idx" ON "StyleFingerprint"("chapterId");
CREATE INDEX "StyleFingerprint_sceneId_idx" ON "StyleFingerprint"("sceneId");
CREATE INDEX "StyleFingerprint_scopeType_idx" ON "StyleFingerprint"("scopeType");
