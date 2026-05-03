import test from "node:test";
import assert from "node:assert/strict";
import {
  AnalysisPassType,
  AnalysisRunStatus,
  AnalysisRunType,
  AnalysisStatus
} from "@prisma/client";
import { PIPELINE_JOB_STATUS } from "../lib/pipeline/jobRules";
import {
  FULL_MANUSCRIPT_PIPELINE_STEPS,
  normalizeCheckpoint
} from "../lib/pipeline/steps";
import { prisma } from "../lib/prisma";

type FakeDb = ReturnType<typeof createFakeDb>;
type FakeRun = {
  id: string;
  manuscriptId: string;
  type: string;
  status: string;
  model: string | null;
  currentPass: string | null;
  globalMemory: unknown;
  checkpoint: unknown;
  metadata: unknown;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
type FakeJob = {
  id: string;
  manuscriptId: string | null;
  chapterId: string | null;
  type: string;
  status: string;
  idempotencyKey: string;
  dependencyIds: unknown;
  readyAt: Date | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  lockExpiresAt: Date | null;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  metadata: unknown;
  result: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

test("stable manuscript analysis chain reaches workspace-ready output idempotently", async () => {
  const oldApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const {
      ensureChapterRewriteDraftsJob,
      ensureManuscriptPipelineJobs,
      runReadyPipelineJobs
    } = await import("../lib/pipeline/pipelineJobs");
    const { evaluateWorkspaceReadiness } = await import(
      "../lib/pipeline/workspaceReadiness"
    );
    const db = createFakeDb();

    await withPatchedPrisma(createPatches(db), async () => {
      await ensureManuscriptPipelineJobs(db.manuscript.id, "FULL_PIPELINE");

      let sawPartialSummarizeWithoutAttemptCost = false;
      for (let index = 0; index < 20; index += 1) {
        const result = await runReadyPipelineJobs({
          manuscriptId: db.manuscript.id,
          maxJobs: 4,
          maxSeconds: 10,
          maxItemsPerStep: 1,
          workerType: "MANUAL",
          workerId: `test:e2e:${index}`
        });
        const summarizeJob = db.jobs.find((job) => job.type === "summarizeChunks");
        const partialSummarize = result.results.find(
          (job) => job.type === "summarizeChunks" && job.status === "queued"
        );

        if (partialSummarize && summarizeJob) {
          sawPartialSummarizeWithoutAttemptCost =
            sawPartialSummarizeWithoutAttemptCost || summarizeJob.attempts === 0;
        }

        assert.notEqual(result.state, "blocked_by_error");
        if (result.state === "done") {
          break;
        }
      }

      assert.equal(sawPartialSummarizeWithoutAttemptCost, true);
      assert.equal(
        db.jobs.every((job) => job.status === PIPELINE_JOB_STATUS.COMPLETED),
        true,
        JSON.stringify(db.jobs.map((job) => [job.type, job.status, job.result, job.error]))
      );
      assert.equal(
        db.jobs.some(
          (job) =>
            job.status === PIPELINE_JOB_STATUS.BLOCKED &&
            dependenciesComplete(job, db.jobs)
        ),
        false
      );
      assert.equal(db.jobs.some((job) => job.status === PIPELINE_JOB_STATUS.FAILED), false);

      const checkpoint = normalizeCheckpoint(db.run?.checkpoint);
      assert.deepEqual(checkpoint.completedSteps, [...FULL_MANUSCRIPT_PIPELINE_STEPS]);
      assert.equal(db.outputsByPass(AnalysisPassType.CHUNK_ANALYSIS).length, 3);
      assert.equal(db.outputsByPass(AnalysisPassType.CHAPTER_AUDIT).length, 2);
      assert.equal(db.outputsByPass(AnalysisPassType.WHOLE_BOOK_AUDIT).length, 1);
      assert.equal(
        isSkipped(db.outputsByPass(AnalysisPassType.CORPUS_COMPARISON)[0]?.output),
        true
      );
      assert.equal(
        isSkipped(db.outputsByPass(AnalysisPassType.TREND_COMPARISON)[0]?.output),
        true
      );
      assert.equal(db.rewritePlans.length, 1);
      assert.equal(db.rewrites.length, 0);
      assert.equal(db.manuscript.analysisStatus, AnalysisStatus.COMPLETED);

      const readiness = evaluateWorkspaceReadiness({
        manuscript: db.manuscript,
        chapters: db.chapters,
        chunks: db.chunks,
        outputs: db.outputs as Array<{ passType: string; output?: unknown; rawText?: string | null }>,
        profile: db.profile,
        rewritePlans: db.rewritePlans,
        chapterRewrites: db.rewrites as Array<{ id: string; chapterId?: string | null; status?: string | null }>,
        findings: db.findings as Array<{ id: string }>,
        jobs: db.jobs,
        checkpoint: db.run?.checkpoint,
        globalSummary:
          typeof db.report?.executiveSummary === "string"
            ? db.report.executiveSummary
            : null
      });

      assert.equal(readiness.state, "completed_with_usable_output");
      assert.equal(readiness.workspaceReady, true);
      assert.equal(readiness.coreAnalysisComplete, true);
      assert.equal(readiness.optionalRewriteDraftsPending, true);
      assert.equal(readiness.contract.chapterRewriteDrafts, "missing");
      assert.equal(readiness.contract.blockedJobsWithCompleteDependencies, 0);
      assert.deepEqual(readiness.contract.missingSteps, []);

      const repeated = await runReadyPipelineJobs({
        manuscriptId: db.manuscript.id,
        maxJobs: 4,
        maxSeconds: 10,
        maxItemsPerStep: 1,
        workerType: "MANUAL",
        workerId: "test:e2e:idempotent"
      });

      assert.equal(repeated.jobsRun, 0);
      assert.equal(repeated.state, "done");
      assert.equal(db.runs.length, 1);

      await ensureChapterRewriteDraftsJob(db.manuscript.id);
      const firstDraftBatch = await runReadyPipelineJobs({
        manuscriptId: db.manuscript.id,
        maxJobs: 1,
        maxSeconds: 10,
        maxItemsPerStep: 1,
        workerType: "MANUAL",
        workerId: "test:e2e:rewrite-drafts-1"
      });
      const secondDraftBatch = await runReadyPipelineJobs({
        manuscriptId: db.manuscript.id,
        maxJobs: 1,
        maxSeconds: 10,
        maxItemsPerStep: 1,
        workerType: "MANUAL",
        workerId: "test:e2e:rewrite-drafts-2"
      });

      assert.equal(firstDraftBatch.results[0]?.type, "generateChapterRewriteDrafts");
      assert.equal(firstDraftBatch.results[0]?.status, "queued");
      assert.equal(secondDraftBatch.results[0]?.type, "generateChapterRewriteDrafts");
      assert.equal(secondDraftBatch.results[0]?.status, "completed");
      assert.equal(db.rewrites.length, 2);
    });
  } finally {
    restoreEnv("OPENAI_API_KEY", oldApiKey);
  }
});

function createFakeDb() {
  const now = new Date("2026-05-01T08:00:00Z");
  const manuscript = {
    id: "manuscript-e2e",
    title: "Stable Chain",
    authorName: null,
    targetGenre: "Fantasy",
    targetAudience: "Adult",
    originalFileUrl: null,
    originalText:
      "Chapter One\n\nA door opens into trouble.\n\nChapter Two\n\nThe promise gets harder.",
    sourceFileName: "stable-chain.txt",
    sourceMimeType: "text/plain",
    sourceFormat: "TXT",
    wordCount: 13,
    chapterCount: 2,
    paragraphCount: 4,
    chunkCount: 3,
    status: "UPLOADED",
    analysisStatus: AnalysisStatus.NOT_STARTED,
    metadata: { language: "en" },
    createdAt: now,
    updatedAt: now
  };
  const chapters = [
    {
      id: "chapter-1",
      manuscriptId: manuscript.id,
      order: 1,
      chapterIndex: 1,
      title: "Chapter One",
      heading: "Chapter One",
      text: "A door opens into trouble. The protagonist chooses danger.",
      summary: null as string | null,
      wordCount: 9,
      status: "PENDING",
      startOffset: null,
      endOffset: null,
      createdAt: now
    },
    {
      id: "chapter-2",
      manuscriptId: manuscript.id,
      order: 2,
      chapterIndex: 2,
      title: "Chapter Two",
      heading: "Chapter Two",
      text: "The promise gets harder. A cost appears.",
      summary: null as string | null,
      wordCount: 7,
      status: "PENDING",
      startOffset: null,
      endOffset: null,
      createdAt: now
    }
  ];
  const chunks = [
    chunkFixture("chunk-1", manuscript.id, chapters[0], 1, "A door opens into trouble."),
    chunkFixture(
      "chunk-2",
      manuscript.id,
      chapters[0],
      2,
      "The protagonist chooses danger."
    ),
    chunkFixture("chunk-3", manuscript.id, chapters[1], 3, "A cost appears.")
  ];
  const runs: FakeRun[] = [];
  const jobs: FakeJob[] = [];
  const outputs: Array<Record<string, unknown>> = [];
  const findings: Array<Record<string, unknown>> = [];
  const rewritePlans: Array<Record<string, unknown>> = [];
  const rewrites: Array<Record<string, unknown>> = [];
  const nodes: Array<Record<string, unknown>> = [];
  const artifacts: Array<Record<string, unknown>> = [];
  const facts: Array<Record<string, unknown>> = [];
  const characters: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const styles: Array<Record<string, unknown>> = [];
  const decisions: Array<Record<string, unknown>> = [];
  let profile: Record<string, unknown> | null = null;
  let report: Record<string, unknown> | null = null;

  return {
    manuscript,
    chapters,
    chunks,
    runs,
    jobs,
    outputs,
    findings,
    rewritePlans,
    rewrites,
    nodes,
    artifacts,
    facts,
    characters,
    events,
    styles,
    decisions,
    get run() {
      return runs[0] ?? null;
    },
    get profile() {
      return profile;
    },
    set profile(value: Record<string, unknown> | null) {
      profile = value;
    },
    get report() {
      return report;
    },
    set report(value: Record<string, unknown> | null) {
      report = value;
    },
    outputsByPass(passType: AnalysisPassType) {
      return outputs.filter((output) => output.passType === passType);
    }
  };
}

function chunkFixture(
  id: string,
  manuscriptId: string,
  chapter: Record<string, unknown>,
  chunkIndex: number,
  text: string
) {
  return {
    id,
    manuscriptId,
    chapterId: chapter.id,
    sceneId: null,
    chunkIndex,
    text,
    wordCount: text.split(/\s+/).length,
    startParagraph: chunkIndex,
    endParagraph: chunkIndex,
    paragraphStart: chunkIndex,
    paragraphEnd: chunkIndex,
    tokenEstimate: 12,
    tokenCount: 12,
    metadata: null,
    localMetrics: null,
    summary: null as string | null,
    embedding: null,
    createdAt: new Date("2026-05-01T08:00:00Z"),
    chapter
  };
}

function createPatches(db: FakeDb): Array<[object, Record<string, unknown>]> {
  return [
    [prisma.analysisRun, analysisRunDelegate(db)],
    [prisma.pipelineJob, pipelineJobDelegate(db)],
    [prisma.workerHeartbeat, { upsert: async (args: { update: unknown }) => args.update }],
    [prisma.manuscript, manuscriptDelegate(db)],
    [prisma.manuscriptChapter, manuscriptChapterDelegate(db)],
    [prisma.scene, sceneDelegate(db)],
    [prisma.paragraph, { count: async () => 0 }],
    [prisma.manuscriptChunk, manuscriptChunkDelegate(db)],
    [prisma.manuscriptNode, manuscriptNodeDelegate(db)],
    [prisma.compilerArtifact, compilerArtifactDelegate(db)],
    [prisma.narrativeFact, memoryCollectionDelegate(db.facts)],
    [prisma.characterState, memoryCollectionDelegate(db.characters)],
    [prisma.plotEvent, memoryCollectionDelegate(db.events)],
    [prisma.styleFingerprint, styleFingerprintDelegate(db)],
    [prisma.analysisOutput, analysisOutputDelegate(db)],
    [prisma.finding, findingDelegate(db)],
    [prisma.manuscriptProfile, manuscriptProfileDelegate(db)],
    [prisma.auditReport, auditReportDelegate(db)],
    [prisma.bookProfile, { findMany: async () => [] }],
    [prisma.corpusChunk, { findMany: async () => [] }],
    [prisma.trendSignal, { findMany: async () => [] }],
    [prisma.rewritePlan, rewritePlanDelegate(db)],
    [prisma.editorialDecision, editorialDecisionDelegate(db)],
    [prisma.chapterRewrite, chapterRewriteDelegate(db)],
    [prisma, { $executeRawUnsafe: async () => 0 }]
  ];
}

function analysisRunDelegate(db: FakeDb) {
  return {
    findFirst: async (args: { where?: Record<string, unknown> } = {}) =>
      db.runs.find((run) => matchesRunWhere(run, args.where)) ?? null,
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const run = db.runs.find((candidate) => candidate.id === args.where.id);
      assert.ok(run);
      Object.assign(run, args.data, { updatedAt: new Date() });
      return run;
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const run = {
        id: "run-1",
        manuscriptId: String(args.data.manuscriptId),
        type: String(args.data.type ?? AnalysisRunType.FULL_AUDIT),
        status: String(args.data.status ?? AnalysisRunStatus.RUNNING),
        model: typeof args.data.model === "string" ? args.data.model : null,
        currentPass: null,
        globalMemory: null,
        checkpoint: args.data.checkpoint ?? { completedSteps: [] },
        metadata: args.data.metadata ?? null,
        error: null,
        startedAt: new Date(),
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      db.runs.push(run);
      return run;
    }
  };
}

function pipelineJobDelegate(db: FakeDb) {
  return {
    findUnique: async (args: { where: { id?: string; idempotencyKey?: string } }) =>
      db.jobs.find((job) =>
        args.where.id ? job.id === args.where.id : job.idempotencyKey === args.where.idempotencyKey
      ) ?? null,
    findMany: async (args: { where?: Record<string, unknown> } = {}) =>
      db.jobs.filter((job) => matchesWhere(job, args.where)),
    count: async (args: { where?: Record<string, unknown> } = {}) =>
      db.jobs.filter((job) => matchesWhere(job, args.where)).length,
    create: async (args: { data: Record<string, unknown> }) => {
      const job = mutableJob(`job-${db.jobs.length + 1}`, args.data);
      db.jobs.push(job);
      return job;
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const job = db.jobs.find((candidate) => candidate.id === args.where.id);
      assert.ok(job);
      applyData(job, args.data);
      return job;
    },
    updateMany: async (args: { where?: Record<string, unknown>; data: Record<string, unknown> }) => {
      const targets = db.jobs.filter((job) => matchesWhere(job, args.where));
      for (const job of targets) {
        applyData(job, args.data);
      }
      return { count: targets.length };
    }
  };
}

function manuscriptDelegate(db: FakeDb) {
  const manuscriptPayload = () => ({
    ...db.manuscript,
    chapters: db.chapters.map((chapter) => ({
      ...chapter,
      scenes: []
    })),
    chunks: db.chunks,
    profile: db.profile,
    outputs: db.outputs,
    reports: db.report ? [db.report] : [],
    rewritePlans: db.rewritePlans,
    runs: db.runs,
    pipelineJobs: db.jobs
  });

  return {
    findUnique: async () => manuscriptPayload(),
    findUniqueOrThrow: async () => manuscriptPayload(),
    update: async (args: { data: Record<string, unknown> }) => {
      Object.assign(db.manuscript, args.data, { updatedAt: new Date() });
      return db.manuscript;
    }
  };
}

function manuscriptChapterDelegate(db: FakeDb) {
  return {
    findFirst: async (args: { where?: Record<string, unknown> } = {}) =>
      db.chapters
        .filter((chapter) => matchesWhere(chapter, args.where))
        .sort((a, b) => Number(b.order) - Number(a.order))[0] ?? null,
    findMany: async (args: { include?: Record<string, unknown> } = {}) =>
      db.chapters.map((chapter) => ({
        ...chapter,
        paragraphs: [],
        scenes: args.include?.scenes ? [] : undefined,
        chunks: args.include?.chunks
          ? db.chunks.filter((chunk) => chunk.chapterId === chapter.id)
          : undefined
      })),
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const chapter = db.chapters.find((candidate) => candidate.id === args.where.id);
      assert.ok(chapter);
      Object.assign(chapter, args.data);
      return chapter;
    }
  };
}

function manuscriptChunkDelegate(db: FakeDb) {
  return {
    findMany: async () => db.chunks,
    count: async (args: { where?: Record<string, unknown> } = {}) =>
      db.chunks.filter((chunk) => matchesWhere(chunk, args.where)).length,
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const chunk = db.chunks.find((candidate) => candidate.id === args.where.id);
      assert.ok(chunk);
      Object.assign(chunk, args.data);
      return chunk;
    }
  };
}

function sceneDelegate(_db: FakeDb) {
  return {
    findMany: async () => []
  };
}

function manuscriptNodeDelegate(db: FakeDb) {
  return {
    findFirst: async (args: { where?: Record<string, unknown> } = {}) =>
      db.nodes.find((node) => matchesWhere(node, args.where)) ?? null,
    upsert: async (args: {
      where: { key: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const existing = db.nodes.find((node) => node.key === args.where.key);
      if (existing) {
        Object.assign(existing, args.update);
        return existing;
      }
      const node = { id: `node-${db.nodes.length + 1}`, ...args.create };
      db.nodes.push(node);
      return node;
    },
    updateMany: async (args: {
      where?: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const targets = db.nodes.filter((node) => matchesWhere(node, args.where));
      for (const node of targets) {
        Object.assign(node, args.data);
      }
      return { count: targets.length };
    }
  };
}

function compilerArtifactDelegate(db: FakeDb) {
  return {
    findFirst: async (args: { where?: Record<string, unknown> } = {}) =>
      db.artifacts.find((artifact) => matchesWhere(artifact, args.where)) ?? null,
    findMany: async (args: { where?: Record<string, unknown> } = {}) =>
      db.artifacts.filter((artifact) => matchesWhere(artifact, args.where)),
    upsert: async (args: {
      where: {
        manuscriptId_artifactType_inputHash: {
          manuscriptId: string;
          artifactType: string;
          inputHash: string;
        };
      };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const key = args.where.manuscriptId_artifactType_inputHash;
      const existing = db.artifacts.find(
        (artifact) =>
          artifact.manuscriptId === key.manuscriptId &&
          artifact.artifactType === key.artifactType &&
          artifact.inputHash === key.inputHash
      );
      if (existing) {
        Object.assign(existing, args.update);
        return existing;
      }
      const artifact = {
        id: `artifact-${db.artifacts.length + 1}`,
        status: "COMPLETED",
        createdAt: new Date(),
        ...args.create
      };
      db.artifacts.push(artifact);
      return artifact;
    }
  };
}

function memoryCollectionDelegate(rows: Array<Record<string, unknown>>) {
  return {
    findMany: async (args: { where?: Record<string, unknown>; take?: number } = {}) =>
      rows.filter((row) => matchesWhere(row, args.where)).slice(0, args.take),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) => {
      const before = rows.length;
      const remaining = rows.filter((row) => !matchesWhere(row, args.where));
      rows.splice(0, rows.length, ...remaining);
      return { count: before - rows.length };
    },
    createMany: async (args: { data: Array<Record<string, unknown>> }) => {
      rows.push(
        ...args.data.map((row, index) => ({
          id: `memory-${rows.length + index + 1}`,
          ...row
        }))
      );
      return { count: args.data.length };
    }
  };
}

function styleFingerprintDelegate(db: FakeDb) {
  return {
    findFirst: async (args: { where?: Record<string, unknown> } = {}) =>
      db.styles.find((style) => matchesWhere(style, args.where)) ?? null,
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) => {
      const before = db.styles.length;
      db.styles = db.styles.filter((style) => !matchesWhere(style, args.where));
      return { count: before - db.styles.length };
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const style = { id: `style-${db.styles.length + 1}`, ...args.data };
      db.styles.push(style);
      return style;
    }
  };
}

function analysisOutputDelegate(db: FakeDb) {
  return {
    findUnique: async (args: { where: { runId_passType_scopeType_scopeId: OutputKey } }) =>
      findOutput(db, args.where.runId_passType_scopeType_scopeId),
    findFirst: async (args: { where?: Record<string, unknown> } = {}) =>
      db.outputs.find((output) => matchesWhere(output, args.where)) ?? null,
    upsert: async (args: {
      where: { runId_passType_scopeType_scopeId: OutputKey };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const existing = findOutput(db, args.where.runId_passType_scopeType_scopeId);
      if (existing) {
        Object.assign(existing, args.update);
        return existing;
      }
      const output = { id: `output-${db.outputs.length + 1}`, ...args.create };
      db.outputs.push(output);
      return output;
    }
  };
}

type OutputKey = {
  runId: string;
  passType: string;
  scopeType: string;
  scopeId: string;
};

function findOutput(db: FakeDb, key: OutputKey) {
  return (
    db.outputs.find(
      (output) =>
        output.runId === key.runId &&
        output.passType === key.passType &&
        output.scopeType === key.scopeType &&
        output.scopeId === key.scopeId
    ) ?? null
  );
}

function findingDelegate(db: FakeDb) {
  return {
    findMany: async (args: { where?: Record<string, unknown> } = {}) =>
      db.findings.filter((finding) => matchesWhere(finding, args.where)),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) => {
      const before = db.findings.length;
      db.findings = db.findings.filter((finding) => !matchesWhere(finding, args.where));
      return { count: before - db.findings.length };
    },
    createMany: async (args: { data: Array<Record<string, unknown>> }) => {
      db.findings.push(
        ...args.data.map((finding, index) => ({
          id: `finding-${db.findings.length + index + 1}`,
          createdAt: new Date(),
          ...finding
        }))
      );
      return { count: args.data.length };
    }
  };
}

function manuscriptProfileDelegate(db: FakeDb) {
  return {
    findUnique: async () => db.profile,
    create: async (args: { data: Record<string, unknown> }) => {
      db.profile = { id: "profile-1", createdAt: new Date(), ...args.data };
      return db.profile;
    }
  };
}

function auditReportDelegate(db: FakeDb) {
  return {
    findUnique: async () =>
      db.report ? { ...db.report, manuscript: db.manuscript } : null,
    create: async (args: { data: Record<string, unknown> }) => {
      db.report = { id: "report-1", createdAt: new Date(), updatedAt: new Date(), ...args.data };
      return db.report;
    },
    update: async (args: { data: Record<string, unknown> }) => {
      assert.ok(db.report);
      Object.assign(db.report, args.data, { updatedAt: new Date() });
      return db.report;
    }
  };
}

function rewritePlanDelegate(db: FakeDb) {
  return {
    findFirst: async (args: { where?: Record<string, unknown> } = {}) =>
      db.rewritePlans.find((plan) => matchesWhere(plan, args.where)) ?? null,
    findFirstOrThrow: async (args: { where?: Record<string, unknown> } = {}) => {
      const plan = db.rewritePlans.find((candidate) => matchesWhere(candidate, args.where));
      assert.ok(plan);
      return plan;
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const plan = { id: `plan-${db.rewritePlans.length + 1}`, createdAt: new Date(), ...args.data };
      db.rewritePlans.push(plan);
      return plan;
    }
  };
}

function chapterRewriteDelegate(db: FakeDb) {
  return {
    findMany: async (args: { where?: Record<string, unknown> } = {}) =>
      db.rewrites.filter((rewrite) => matchesWhere(rewrite, args.where)),
    findFirst: async (args: { where?: Record<string, unknown> } = {}) =>
      db.rewrites.find((rewrite) => matchesWhere(rewrite, args.where)) ?? null,
    updateMany: async () => ({ count: 0 }),
    aggregate: async (args: { where?: Record<string, unknown> } = {}) => {
      const versions = db.rewrites
        .filter((rewrite) => matchesWhere(rewrite, args.where))
        .map((rewrite) => Number(rewrite.version ?? 0));
      return { _max: { version: versions.length ? Math.max(...versions) : null } };
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const rewrite = {
        id: `rewrite-${db.rewrites.length + 1}`,
        createdAt: new Date(),
        ...args.data
      };
      db.rewrites.push(rewrite);
      return rewrite;
    }
  };
}

function editorialDecisionDelegate(db: FakeDb) {
  return {
    createMany: async (args: { data: Array<Record<string, unknown>> }) => {
      db.decisions.push(
        ...args.data.map((decision, index) => ({
          id: `decision-${db.decisions.length + index + 1}`,
          ...decision
        }))
      );
      return { count: args.data.length };
    }
  };
}

function mutableJob(id: string, data: Record<string, unknown>): FakeJob {
  const now = new Date();

  return {
    id,
    manuscriptId: stringOrNull(data.manuscriptId),
    chapterId: stringOrNull(data.chapterId),
    type: String(data.type),
    status: String(data.status ?? PIPELINE_JOB_STATUS.QUEUED),
    idempotencyKey: String(data.idempotencyKey),
    dependencyIds: data.dependencyIds ?? null,
    readyAt: data.readyAt instanceof Date ? data.readyAt : null,
    lockedAt: data.lockedAt instanceof Date ? data.lockedAt : null,
    lockedBy: stringOrNull(data.lockedBy),
    lockExpiresAt: data.lockExpiresAt instanceof Date ? data.lockExpiresAt : null,
    attempts: typeof data.attempts === "number" ? data.attempts : 0,
    maxAttempts: typeof data.maxAttempts === "number" ? data.maxAttempts : 3,
    error: stringOrNull(data.error),
    metadata: data.metadata ?? null,
    result: data.result ?? null,
    startedAt: data.startedAt instanceof Date ? data.startedAt : null,
    completedAt: data.completedAt instanceof Date ? data.completedAt : null,
    createdAt: now,
    updatedAt: now
  };
}

function applyData(target: Record<string, unknown>, data: Record<string, unknown>) {
  const attempts = data.attempts;
  const copy = { ...data };
  delete copy.attempts;
  Object.assign(target, copy, { updatedAt: new Date() });

  if (isIncrement(attempts)) {
    target.attempts = Number(target.attempts ?? 0) + attempts.increment;
  } else if (typeof attempts === "number") {
    target.attempts = attempts;
  }
}

function matchesRunWhere(run: FakeRun, where: Record<string, unknown> = {}) {
  if (!matchesWhere(run, where)) {
    return false;
  }

  const status = recordValue(where.status);
  if (status?.in && Array.isArray(status.in)) {
    return status.in.includes(run.status);
  }

  return true;
}

function matchesWhere(item: Record<string, unknown>, where: Record<string, unknown> = {}) {
  if (!where) {
    return true;
  }

  const and = Array.isArray(where.AND) ? where.AND : [];
  if (and.length > 0 && !and.every((part) => matchesWhere(item, recordValue(part) ?? {}))) {
    return false;
  }

  const or = Array.isArray(where.OR) ? where.OR : [];
  if (or.length > 0 && !or.some((part) => matchesWhere(item, recordValue(part) ?? {}))) {
    return false;
  }

  for (const [key, expected] of Object.entries(where)) {
    if (key === "AND" || key === "OR") {
      continue;
    }
    if (!matchesField(item[key], expected)) {
      return false;
    }
  }

  return true;
}

function matchesField(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object" || expected instanceof Date) {
    return actual === expected;
  }

  const record = recordValue(expected);
  if (!record) {
    return actual === expected;
  }

  if (Array.isArray(record.in)) {
    return record.in.includes(actual);
  }

  if (record.not === null) {
    return actual !== null && actual !== undefined;
  }

  if (record.lte instanceof Date) {
    return actual instanceof Date && actual <= record.lte;
  }

  if (typeof record.lt === "number") {
    return typeof actual === "number" && actual < record.lt;
  }

  if (typeof record.gte === "number") {
    return typeof actual === "number" && actual >= record.gte;
  }

  if (record.path && record.equals !== undefined) {
    return nestedValue(actual, record.path) === record.equals;
  }

  return Object.entries(record).every(([key, value]) =>
    matchesField(recordValue(actual)?.[key], value)
  );
}

function dependenciesComplete(job: FakeJob, jobs: FakeJob[]) {
  const dependencyIds = Array.isArray(job.dependencyIds)
    ? job.dependencyIds.map(String)
    : [];
  const completed = new Set(
    jobs
      .filter((candidate) => candidate.status === PIPELINE_JOB_STATUS.COMPLETED)
      .map((candidate) => candidate.id)
  );

  return dependencyIds.every((id) => completed.has(id));
}

function isSkipped(value: unknown) {
  const record = recordValue(value);
  return record?.status === "skipped" && record.skipped === true;
}

async function withPatchedPrisma<T>(
  patches: Array<[object, Record<string, unknown>]>,
  callback: () => Promise<T>
) {
  const originals: Array<{
    target: object;
    key: string;
    descriptor: PropertyDescriptor | undefined;
  }> = [];

  for (const [target, patch] of patches) {
    for (const [key, value] of Object.entries(patch)) {
      originals.push({
        target,
        key,
        descriptor: Object.getOwnPropertyDescriptor(target, key)
      });
      Object.defineProperty(target, key, {
        configurable: true,
        writable: true,
        value
      });
    }
  }

  try {
    return await callback();
  } finally {
    for (const original of originals.reverse()) {
      if (original.descriptor) {
        Object.defineProperty(original.target, original.key, original.descriptor);
      } else {
        delete (original.target as Record<string, unknown>)[original.key];
      }
    }
  }
}

function nestedValue(value: unknown, path: unknown) {
  if (!Array.isArray(path)) {
    return undefined;
  }

  return path.reduce<unknown>((current, segment) => {
    const record = recordValue(current);
    return record ? record[String(segment)] : undefined;
  }, value);
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function isIncrement(value: unknown): value is { increment: number } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { increment?: unknown }).increment === "number"
  );
}
