import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PipelineJob } from "@prisma/client";
import { pipelineStartHttpStatus } from "../lib/pipeline/startPipeline";
import { plannedPipelineJobs } from "../lib/pipeline/jobPlanner";
import {
  CORPUS_ANALYSIS_PIPELINE_NAME
} from "../lib/corpus/corpusAnalysisJobs";
import {
  areDependenciesComplete,
  canAttemptJob,
  dependencyIdsFromJson,
  executionModeLabel,
  isCompletedJob,
  isJobCancelled,
  isLockStale,
  nextStatusAfterJobError,
  PIPELINE_JOB_STATUS
} from "../lib/pipeline/jobRules";
import {
  ensureManuscriptPipelineJobs,
  pipelineJobScopeWhere,
  runReadyPipelineJobs
} from "../lib/pipeline/pipelineJobs";
import { prisma } from "../lib/prisma";

type MutableJob = PipelineJob;
type MutableRun = {
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

test("direct audit route delegates to job-backed pipeline starter", () => {
  const source = readFileSync(
    "app/api/manuscripts/[id]/audit/route.ts",
    "utf8"
  );
  const startSource = readFileSync("lib/pipeline/startPipeline.ts", "utf8");

  assert.match(source, /startManuscriptPipeline/);
  assert.doesNotMatch(source, /runFullManuscriptPipeline/);
  assert.doesNotMatch(startSource, /runFullManuscriptPipeline/);
});

test("pipeline.started plans ordered jobs with dependencies", () => {
  const jobs = plannedPipelineJobs("m1", {
    completedSteps: ["parseAndNormalizeManuscript"]
  });

  assert.equal(jobs.length > 3, true);
  assert.equal(jobs[0].type, "parseAndNormalizeManuscript");
  assert.equal(jobs[0].completedFromCheckpoint, true);
  assert.deepEqual(jobs[0].dependencyKeys, []);
  assert.deepEqual(jobs[1].dependencyKeys, [jobs[0].idempotencyKey]);
});

test("stuck manuscript with no jobs gets resumable jobs from checkpoint", async () => {
  const manuscriptId = "manuscript-stuck-summarize";
  const run = mutableRun(manuscriptId, {
    completedSteps: [
      "parseAndNormalizeManuscript",
      "splitIntoChapters",
      "splitIntoChunks",
      "createEmbeddingsForChunks"
    ],
    currentStep: "summarizeChunks"
  });
  const jobs: MutableJob[] = [];

  await withPatchedPrisma(
    [
      [
        prisma.manuscript,
        {
          findUnique: async () => ({ id: manuscriptId }),
          update: async (args: { data: Record<string, unknown> }) => ({
            id: manuscriptId,
            ...args.data
          })
        }
      ],
      [prisma.analysisRun, analysisRunPatch(run)],
      [prisma.pipelineJob, pipelineJobPatch(jobs)],
      [
        prisma.workerHeartbeat,
        {
          upsert: async (args: { update: Record<string, unknown> }) => args.update
        }
      ]
    ],
    async () => {
      const ensured = await ensureManuscriptPipelineJobs(manuscriptId, "RESUME");

      assert.equal(ensured.run.id, run.id);
      assert.equal(jobs.length, 13);
      assert.deepEqual(
        jobs.slice(0, 4).map((job) => job.status),
        Array(4).fill(PIPELINE_JOB_STATUS.COMPLETED)
      );
      assert.equal(jobs[4].type, "summarizeChunks");
      assert.equal(jobs[4].status, PIPELINE_JOB_STATUS.QUEUED);
      assert.deepEqual(
        jobs.slice(4).map((job) => job.type),
        [
          "summarizeChunks",
          "summarizeChapters",
          "createManuscriptProfile",
          "runChapterAudits",
          "runWholeBookAudit",
          "compareAgainstCorpus",
          "compareAgainstTrendSignals",
          "createRewritePlan",
          "generateChapterRewriteDrafts"
        ]
      );
      assert.equal(
        jobs.slice(5).every((job) => job.status === PIPELINE_JOB_STATUS.BLOCKED),
        true
      );
    }
  );
});

test("run-until-idle bootstraps missing manuscript jobs before running", async () => {
  const manuscriptId = "manuscript-manual-bootstrap";
  const oldApiKey = process.env.OPENAI_API_KEY;
  const run = mutableRun(manuscriptId, {
    completedSteps: [
      "parseAndNormalizeManuscript",
      "splitIntoChapters",
      "splitIntoChunks"
    ],
    currentStep: "createEmbeddingsForChunks"
  });
  const jobs: MutableJob[] = [];
  const chunks = [
    {
      id: "chunk-1",
      manuscriptId,
      chapterId: "chapter-1",
      sceneId: null,
      chunkIndex: 1,
      text: "A small chunk.",
      wordCount: 3,
      startParagraph: 1,
      endParagraph: 1,
      paragraphStart: 1,
      paragraphEnd: 1,
      tokenEstimate: 3,
      tokenCount: 3,
      metadata: null,
      localMetrics: null,
      summary: null,
      embedding: null,
      createdAt: new Date("2026-04-29T05:00:00Z")
    }
  ];

  delete process.env.OPENAI_API_KEY;

  try {
    await withPatchedPrisma(
      [
        [
          prisma.manuscript,
          {
            findUnique: async () => ({ id: manuscriptId }),
            update: async (args: { data: Record<string, unknown> }) => ({
              id: manuscriptId,
              ...args.data
            })
          }
        ],
        [prisma.analysisRun, analysisRunPatch(run)],
        [prisma.pipelineJob, pipelineJobPatch(jobs)],
        [
          prisma.manuscriptChunk,
          {
            findMany: async () => chunks,
            update: async (args: {
              where: { id: string };
              data: Record<string, unknown>;
            }) => {
              const chunk = chunks.find((candidate) => candidate.id === args.where.id);
              assert.ok(chunk);
              Object.assign(chunk, args.data);
              return chunk;
            }
          }
        ],
        [
          prisma.workerHeartbeat,
          {
            upsert: async (args: { update: Record<string, unknown> }) => args.update
          }
        ]
      ],
      async () => {
        const result = await runReadyPipelineJobs({
          manuscriptId,
          maxJobs: 1,
          maxSeconds: 5,
          workerType: "MANUAL",
          workerId: "test:manual-runner"
        });

        const embeddingJob = jobs.find(
          (job) => job.type === "createEmbeddingsForChunks"
        );
        const summarizeJob = jobs.find((job) => job.type === "summarizeChunks");

        assert.equal(result.jobsRun, 1);
        assert.equal(embeddingJob?.status, PIPELINE_JOB_STATUS.COMPLETED);
        assert.equal(summarizeJob?.status, PIPELINE_JOB_STATUS.QUEUED);
        assert.deepEqual(result.readyJobIds, [summarizeJob?.id]);
        assert.equal(result.remainingReadyJobs, 1);
        assert.equal(result.hasRemainingWork, true);
      }
    );
  } finally {
    restoreEnv("OPENAI_API_KEY", oldApiKey);
  }
});

test("job.created can run one eligible job", () => {
  assert.equal(
    canAttemptJob({
      status: PIPELINE_JOB_STATUS.QUEUED,
      readyAt: new Date("2026-04-29T05:00:00Z"),
      lockedAt: null
    }, new Date("2026-04-29T05:01:00Z")),
    true
  );
});

test("active locks prevent duplicate execution until stale", () => {
  const now = new Date("2026-04-29T05:01:00Z");

  assert.equal(
    canAttemptJob(
      {
        status: PIPELINE_JOB_STATUS.QUEUED,
        lockedAt: new Date("2026-04-29T05:00:00Z"),
        lockExpiresAt: new Date("2026-04-29T05:05:00Z")
      },
      now
    ),
    false
  );
  assert.equal(
    canAttemptJob(
      {
        status: PIPELINE_JOB_STATUS.QUEUED,
        lockedAt: new Date("2026-04-29T04:00:00Z"),
        lockExpiresAt: new Date("2026-04-29T05:00:00Z")
      },
      now
    ),
    true
  );
});

test("dependencies block jobs until all prerequisites complete", () => {
  const ids = dependencyIdsFromJson(["a", "b"]);

  assert.equal(
    areDependenciesComplete(ids, [
      { id: "a", status: PIPELINE_JOB_STATUS.COMPLETED },
      { id: "b", status: PIPELINE_JOB_STATUS.QUEUED }
    ]),
    false
  );
  assert.equal(
    areDependenciesComplete(ids, [
      { id: "a", status: PIPELINE_JOB_STATUS.COMPLETED },
      { id: "b", status: PIPELINE_JOB_STATUS.COMPLETED }
    ]),
    true
  );
});

test("completed and cancelled jobs are skipped", () => {
  assert.equal(isCompletedJob({ status: PIPELINE_JOB_STATUS.COMPLETED }), true);
  assert.equal(isJobCancelled({ status: PIPELINE_JOB_STATUS.CANCELLED }), true);
  assert.equal(canAttemptJob({ status: PIPELINE_JOB_STATUS.COMPLETED }), false);
  assert.equal(canAttemptJob({ status: PIPELINE_JOB_STATUS.CANCELLED }), false);
});

test("stale locks are detectable", () => {
  assert.equal(
    isLockStale(
      {
        status: PIPELINE_JOB_STATUS.RUNNING,
        lockExpiresAt: new Date("2026-04-29T05:00:00Z")
      },
      new Date("2026-04-29T05:01:00Z")
    ),
    true
  );
});

test("failed jobs retry until maxAttempts then fail", () => {
  assert.equal(
    nextStatusAfterJobError({ attempts: 2, maxAttempts: 3 }),
    PIPELINE_JOB_STATUS.RETRYING
  );
  assert.equal(
    nextStatusAfterJobError({ attempts: 3, maxAttempts: 3 }),
    PIPELINE_JOB_STATUS.FAILED
  );
});

test("fallback runner mode remains explicit when Inngest is disabled", () => {
  assert.equal(
    executionModeLabel({ inngestEnabled: false }),
    "Manual/request runner"
  );
  assert.equal(
    executionModeLabel({ inngestEnabled: true }),
    "Inngest worker enabled"
  );
});

test("pipeline start responses only accept successful Inngest dispatches", () => {
  assert.equal(
    pipelineStartHttpStatus({ executionMode: "INNGEST", accepted: true }),
    202
  );
  assert.equal(
    pipelineStartHttpStatus({ executionMode: "INNGEST", accepted: false }),
    503
  );
  assert.equal(
    pipelineStartHttpStatus({ executionMode: "MANUAL", accepted: false }),
    200
  );
});

test("ready runner can scope selection to corpus pipeline jobs", () => {
  const where = pipelineJobScopeWhere({ corpusBookId: "book-1" });

  assert.deepEqual(where, {
    AND: [
      {
        metadata: {
          path: ["pipeline"],
          equals: CORPUS_ANALYSIS_PIPELINE_NAME
        }
      },
      {
        metadata: {
          path: ["corpusBookId"],
          equals: "book-1"
        }
      }
    ]
  });
  assert.equal(
    (where as { manuscriptId?: unknown }).manuscriptId,
    undefined
  );
});

test("corpusBookId scope does not match manuscript-only job filters", () => {
  const manuscriptWhere = pipelineJobScopeWhere({ manuscriptId: "m1" });
  const corpusWhere = pipelineJobScopeWhere({ corpusBookId: "book-2" });

  assert.deepEqual(manuscriptWhere, { manuscriptId: "m1" });
  assert.deepEqual(
    corpusWhere,
    {
      AND: [
        {
          metadata: {
            path: ["pipeline"],
            equals: CORPUS_ANALYSIS_PIPELINE_NAME
          }
        },
        {
          metadata: {
            path: ["corpusBookId"],
            equals: "book-2"
          }
        }
      ]
    }
  );
});

test("ambiguous ready runner scope is rejected", () => {
  assert.throws(
    () => pipelineJobScopeWhere({ manuscriptId: "m1", corpusBookId: "book-1" }),
    /cannot include both manuscriptId and corpusBookId/
  );
});

function mutableRun(manuscriptId: string, checkpoint: unknown): MutableRun {
  const now = new Date("2026-04-29T05:00:00Z");

  return {
    id: `${manuscriptId}-run`,
    manuscriptId,
    type: "FULL_AUDIT",
    status: "RUNNING",
    model: "test-model",
    currentPass: "CHUNK_ANALYSIS",
    globalMemory: null,
    checkpoint,
    metadata: null,
    error: null,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function analysisRunPatch(run: MutableRun) {
  return {
    findFirst: async () => run,
    update: async (args: { data: Record<string, unknown> }) => {
      Object.assign(run, args.data, { updatedAt: new Date() });
      return run;
    },
    create: async (args: { data: Record<string, unknown> }) => {
      Object.assign(run, args.data, { id: run.id, updatedAt: new Date() });
      return run;
    }
  };
}

function pipelineJobPatch(jobs: MutableJob[]) {
  return {
    findUnique: async (args: {
      where: { id?: string; idempotencyKey?: string };
    }) =>
      jobs.find((job) =>
        args.where.id
          ? job.id === args.where.id
          : job.idempotencyKey === args.where.idempotencyKey
      ) ?? null,
    findMany: async (args: { where?: Record<string, unknown> } = {}) =>
      filterJobs(jobs, args.where),
    count: async (args: { where?: Record<string, unknown> } = {}) =>
      filterJobs(jobs, args.where).length,
    create: async (args: { data: Record<string, unknown> }) => {
      const job = mutableJob(`job-${jobs.length + 1}`, args.data);
      jobs.push(job);
      return job;
    },
    update: async (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const job = jobs.find((candidate) => candidate.id === args.where.id);
      assert.ok(job, `Expected job ${args.where.id} to exist`);
      applyJobData(job, args.data);
      return job;
    },
    updateMany: async (args: {
      where: { id?: string };
      data: Record<string, unknown>;
    }) => {
      const job = jobs.find((candidate) => candidate.id === args.where.id);
      if (!job) {
        return { count: 0 };
      }

      applyJobData(job, args.data);
      return { count: 1 };
    }
  };
}

function mutableJob(id: string, data: Record<string, unknown>): MutableJob {
  const now = new Date("2026-04-29T05:00:00Z");

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
    lockedBy: typeof data.lockedBy === "string" ? data.lockedBy : null,
    lockExpiresAt: data.lockExpiresAt instanceof Date ? data.lockExpiresAt : null,
    attempts: typeof data.attempts === "number" ? data.attempts : 0,
    maxAttempts: typeof data.maxAttempts === "number" ? data.maxAttempts : 3,
    error: typeof data.error === "string" ? data.error : null,
    metadata: data.metadata ?? null,
    result: data.result ?? null,
    startedAt: data.startedAt instanceof Date ? data.startedAt : null,
    completedAt: data.completedAt instanceof Date ? data.completedAt : null,
    createdAt: now,
    updatedAt: now
  };
}

function applyJobData(job: MutableJob, data: Record<string, unknown>) {
  const attempts = data.attempts;
  const copy = { ...data };

  delete copy.attempts;
  Object.assign(job, copy, { updatedAt: new Date() });

  if (isIncrement(attempts)) {
    job.attempts += attempts.increment;
  } else if (typeof attempts === "number") {
    job.attempts = attempts;
  }
}

function filterJobs(jobs: MutableJob[], where: Record<string, unknown> = {}) {
  return jobs.filter((job) => {
    if (typeof where.manuscriptId === "string" && job.manuscriptId !== where.manuscriptId) {
      return false;
    }

    const id = recordValue(where.id);
    if (id?.in && Array.isArray(id.in) && !id.in.includes(job.id)) {
      return false;
    }

    const status = where.status;
    if (typeof status === "string" && job.status !== status) {
      return false;
    }
    const statusRecord = recordValue(status);
    if (
      statusRecord?.in &&
      Array.isArray(statusRecord.in) &&
      !statusRecord.in.includes(job.status)
    ) {
      return false;
    }

    const type = recordValue(where.type);
    if (type?.in && Array.isArray(type.in) && !type.in.includes(job.type)) {
      return false;
    }

    const lockExpiresAt = recordValue(where.lockExpiresAt);
    if (
      lockExpiresAt?.lte instanceof Date &&
      (!job.lockExpiresAt || job.lockExpiresAt > lockExpiresAt.lte)
    ) {
      return false;
    }

    return true;
  });
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
