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
  MANUAL_FINAL_SYNTHESIS_LOCK_MS,
  nextStatusAfterJobError,
  PIPELINE_JOB_STATUS
} from "../lib/pipeline/jobRules";
import {
  ensureManuscriptPipelineJobs,
  ensureChapterRewriteDraftsJob,
  pipelineJobScopeWhere,
  releaseStaleLocks,
  runPipelineJob,
  runReadyPipelineJobs
} from "../lib/pipeline/pipelineJobs";
import { pipelineStepJobKey } from "../lib/pipeline/jobPlanner";
import {
  isStepComplete,
  normalizeCheckpoint
} from "../lib/pipeline/steps";
import { manuscriptAdminJobRunner } from "../lib/server/manuscriptAdminJobs";
import {
  setOpenAIClientForTest,
  type OpenAIClient
} from "../lib/analysis/openai";
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
      assert.equal(jobs.length, 18);
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
          "buildManuscriptNodes",
          "compileSceneDigests",
          "extractNarrativeMemory",
          "compileChapterCapsules",
          "compileWholeBookMap",
          "createNextBestEditorialActions",
          "runChapterAudits",
          "runWholeBookAudit",
          "compareAgainstCorpus",
          "compareAgainstTrendSignals",
          "createRewritePlan"
        ]
      );
      assert.equal(
        jobs.slice(5).every((job) => job.status === PIPELINE_JOB_STATUS.BLOCKED),
        true
      );
    }
  );
});

test("rewrite draft step is planned only when explicitly requested", async () => {
  const manuscriptId = "manuscript-rewrite-drafts-manual";
  const run = mutableRun(manuscriptId, {
    completedSteps: [
      "parseAndNormalizeManuscript",
      "splitIntoChapters",
      "splitIntoChunks",
      "createEmbeddingsForChunks",
      "summarizeChunks",
      "summarizeChapters",
      "createManuscriptProfile",
      "runChapterAudits",
      "runWholeBookAudit",
      "compareAgainstCorpus",
      "compareAgainstTrendSignals",
      "createRewritePlan"
    ]
  });
  const jobs: MutableJob[] = [];

  await withPatchedPrisma(
    manuscriptRunnerPatches({ manuscriptId, run, jobs }),
    async () => {
      await ensureManuscriptPipelineJobs(manuscriptId, "RESUME");

      assert.equal(
        jobs.some((job) => job.type === "generateChapterRewriteDrafts"),
        false
      );

      const rewriteDraftJob = await ensureChapterRewriteDraftsJob(manuscriptId);

      assert.equal(rewriteDraftJob.type, "generateChapterRewriteDrafts");
      assert.equal(rewriteDraftJob.status, PIPELINE_JOB_STATUS.QUEUED);
      assert.equal(
        jobs.filter((job) => job.type === "generateChapterRewriteDrafts").length,
        1
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

test("ready runner reports a still-locked running manuscript job", async () => {
  const manuscriptId = "manuscript-running-lock";
  const checkpoint = checkpointBeforeRunChapterAudits();
  const runningPlan = plannedPipelineJobs(manuscriptId, checkpoint).find(
    (job) => job.type === "runChapterAudits"
  );
  assert.ok(runningPlan);

  const lockExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const jobs: MutableJob[] = [
    mutableJob("running-audits-job", {
      manuscriptId,
      type: "runChapterAudits",
      status: PIPELINE_JOB_STATUS.RUNNING,
      idempotencyKey: runningPlan.idempotencyKey,
      lockedAt: new Date(),
      lockedBy: "inngest:event-active",
      lockExpiresAt,
      attempts: 1
    })
  ];
  const run = mutableRun(manuscriptId, checkpoint);

  await withPatchedPrisma(
    manuscriptRunnerPatches({ manuscriptId, run, jobs }),
    async () => {
      const result = await runReadyPipelineJobs({
        manuscriptId,
        maxJobs: 1,
        maxSeconds: 5,
        workerType: "MANUAL",
        workerId: "manual:test-active-lock"
      });

      assert.equal(result.jobsRun, 0);
      assert.equal(result.reason, "waiting_for_lock_expiry");
      assert.equal(result.blockingJob?.id, "running-audits-job");
      assert.equal(result.blockingJob?.type, "runChapterAudits");
      assert.equal(result.blockingJob?.lockedBy, "inngest:event-active");
      assert.equal(result.blockingJob?.stale, false);
      assert.match(result.message ?? "", /runChapterAudits is currently marked running/);
      assert.match(result.message ?? "", /recovered after the lock expires/);
    }
  );
});

test("ready runner recovers stale running manuscript jobs before retrying them", async () => {
  const manuscriptId = "manuscript-stale-running";
  const checkpoint = checkpointBeforeRunChapterAudits();
  const runningPlan = plannedPipelineJobs(manuscriptId, checkpoint).find(
    (job) => job.type === "runChapterAudits"
  );
  assert.ok(runningPlan);

  const jobs: MutableJob[] = [
    mutableJob("stale-audits-job", {
      manuscriptId,
      type: "runChapterAudits",
      status: PIPELINE_JOB_STATUS.RUNNING,
      idempotencyKey: runningPlan.idempotencyKey,
      lockedAt: new Date(Date.now() - 20 * 60 * 1000),
      lockedBy: "inngest:event-stale",
      lockExpiresAt: new Date(Date.now() - 10 * 60 * 1000),
      attempts: 1,
      maxAttempts: 3
    })
  ];
  const run = mutableRun(manuscriptId, checkpoint);

  await withPatchedPrisma(
    manuscriptRunnerPatches({ manuscriptId, run, jobs }),
    async () => {
      const result = await runReadyPipelineJobs({
        manuscriptId,
        maxJobs: 1,
        maxSeconds: 5,
        workerType: "MANUAL",
        workerId: "manual:test-stale-lock"
      });

      assert.equal(result.jobsRun, 1);
      assert.equal(result.reason, undefined);
      assert.equal(result.recoveredStaleJobs[0]?.id, "stale-audits-job");
      assert.equal(result.recoveredStaleJobs[0]?.stale, true);
      assert.equal(jobs[0].status, PIPELINE_JOB_STATUS.COMPLETED);
      assert.equal(jobs[0].lockedAt, null);
      assert.equal(jobs[0].lockedBy, null);
      assert.equal(jobs[0].lockExpiresAt, null);
      assert.equal(result.remainingReadyJobs, 1);
    }
  );
});

test("stale running manuscript jobs without lock expiry are recovered", async () => {
  const manuscriptId = "manuscript-stale-running-without-expiry";
  const checkpoint = checkpointBeforeRunChapterAudits();
  const runningPlan = plannedPipelineJobs(manuscriptId, checkpoint).find(
    (job) => job.type === "runChapterAudits"
  );
  assert.ok(runningPlan);

  const jobs: MutableJob[] = [
    mutableJob("old-running-audits-job", {
      manuscriptId,
      type: "runChapterAudits",
      status: PIPELINE_JOB_STATUS.RUNNING,
      idempotencyKey: runningPlan.idempotencyKey,
      lockedAt: new Date(Date.now() - 20 * 60 * 1000),
      lockedBy: "legacy-worker-without-expiry",
      lockExpiresAt: null,
      attempts: 1,
      maxAttempts: 3
    })
  ];
  const run = mutableRun(manuscriptId, checkpoint);

  await withPatchedPrisma(
    manuscriptRunnerPatches({ manuscriptId, run, jobs }),
    async () => {
      const recovered = await releaseStaleLocks(manuscriptId);

      assert.equal(recovered[0]?.id, "old-running-audits-job");
      assert.equal(recovered[0]?.stale, true);
      assert.equal(jobs[0].status, PIPELINE_JOB_STATUS.QUEUED);
      assert.equal(jobs[0].lockedAt, null);
      assert.equal(jobs[0].lockedBy, null);
      assert.equal(jobs[0].lockExpiresAt, null);
      assert.equal(jobs[0].error, null);
    }
  );
});

test("zero ready jobs with unfinished work returns a specific runner reason", async () => {
  const jobs: MutableJob[] = [
    mutableJob("blocked-rewrite-plan", {
      type: "createRewritePlan",
      status: PIPELINE_JOB_STATUS.BLOCKED,
      idempotencyKey: "blocked-rewrite-plan",
      dependencyIds: ["missing-dependency"]
    })
  ];

  await withPatchedPrisma(
    [
      [prisma.pipelineJob, pipelineJobPatch(jobs)],
      [
        prisma.workerHeartbeat,
        {
          upsert: async (args: { update: Record<string, unknown> }) => args.update
        }
      ]
    ],
    async () => {
      const result = await runReadyPipelineJobs({
        maxJobs: 1,
        maxSeconds: 5,
        workerType: "MANUAL",
        workerId: "manual:test-no-ready"
      });

      assert.equal(result.jobsRun, 0);
      assert.equal(result.remainingReadyJobs, 0);
      assert.equal(result.hasRemainingWork, true);
      assert.equal(result.reason, "no_ready_jobs_but_unfinished_work");
      assert.equal(result.blockingJob?.id, "blocked-rewrite-plan");
      assert.match(result.message ?? "", /no job is currently ready to run/);
    }
  );
});

test("manual manuscript runner response includes an operator-readable lock reason", async () => {
  const manuscriptId = "manuscript-manual-readable-lock";
  const checkpoint = checkpointBeforeRunChapterAudits();
  const runningPlan = plannedPipelineJobs(manuscriptId, checkpoint).find(
    (job) => job.type === "runChapterAudits"
  );
  assert.ok(runningPlan);

  const jobs: MutableJob[] = [
    mutableJob("manual-running-audits-job", {
      manuscriptId,
      type: "runChapterAudits",
      status: PIPELINE_JOB_STATUS.RUNNING,
      idempotencyKey: runningPlan.idempotencyKey,
      lockedAt: new Date(),
      lockedBy: "inngest:event-visible",
      lockExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 1
    })
  ];
  const run = mutableRun(manuscriptId, checkpoint);

  await withPatchedPrisma(
    manuscriptRunnerPatches({ manuscriptId, run, jobs }),
    async () => {
      const result = await manuscriptAdminJobRunner.run(manuscriptId, {});

      assert.equal(result.batchesRun, 1);
      assert.equal(result.totalJobsRun, 0);
      assert.equal(result.stoppedReason, "active_running_lock");
      assert.equal(result.blockingJob?.type, "runChapterAudits");
      assert.match(result.message ?? "", /Paused because runChapterAudits/);
      assert.match(result.message ?? "", /locked until/);
    }
  );
});

test("partial summarizeChunks progress requeues without exhausting maxAttempts", async () => {
  const manuscriptId = "manuscript-partial-attempts";
  const oldApiKey = process.env.OPENAI_API_KEY;
  const run = mutableRun(manuscriptId, {
    completedSteps: [
      "parseAndNormalizeManuscript",
      "splitIntoChapters",
      "splitIntoChunks",
      "createEmbeddingsForChunks"
    ],
    currentStep: "summarizeChunks"
  });
  const job = mutableJob("summarize-job", {
    manuscriptId,
    type: "summarizeChunks",
    status: PIPELINE_JOB_STATUS.QUEUED,
    idempotencyKey: "summarize-job",
    attempts: 5,
    maxAttempts: 3
  });
  const jobs = [job];
  const chunks = summarizeChunkFixtures(manuscriptId, 2);
  const outputs: Array<Record<string, unknown>> = [];

  delete process.env.OPENAI_API_KEY;

  try {
    await withPatchedPrisma(
      summarizeChunksPatches({ manuscriptId, run, jobs, chunks, outputs }),
      async () => {
        const result = await runPipelineJob(job.id, {
          maxItemsPerStep: 1,
          workerId: "test:partial"
        });

        assert.equal(result.status, "queued");
        assert.equal(job.status, PIPELINE_JOB_STATUS.QUEUED);
        assert.equal(job.error, null);
        assert.equal(job.readyAt, null);
        assert.equal(job.lockedAt, null);
        assert.equal(job.lockedBy, null);
        assert.equal(job.lockExpiresAt, null);
        assert.equal(job.attempts < job.maxAttempts, true);
        assert.equal(job.attempts, 2);
        assert.deepEqual(job.result, {
          analyzed: 1,
          remaining: 1,
          complete: false
        });
        assert.equal(outputs.length, 1);

        const checkpoint = normalizeCheckpoint(run.checkpoint);
        assert.equal(checkpoint.currentStep, "summarizeChunks");
        assert.deepEqual(checkpoint.completedSteps?.includes("summarizeChunks"), false);
        assert.equal(
          (checkpoint.stepMetadata?.summarizeChunks as Record<string, unknown>)
            .remaining,
          1
        );
      }
    );
  } finally {
    restoreEnv("OPENAI_API_KEY", oldApiKey);
  }
});

test("repeated summarizeChunks partial runs finish and unblock summarizeChapters", async () => {
  const manuscriptId = "manuscript-partial-completes";
  const oldApiKey = process.env.OPENAI_API_KEY;
  const run = mutableRun(manuscriptId, {
    completedSteps: [
      "parseAndNormalizeManuscript",
      "splitIntoChapters",
      "splitIntoChunks",
      "createEmbeddingsForChunks"
    ],
    currentStep: "summarizeChunks"
  });
  const summarizeJob = mutableJob("summarize-job", {
    manuscriptId,
    type: "summarizeChunks",
    status: PIPELINE_JOB_STATUS.QUEUED,
    idempotencyKey: "summarize-job",
    maxAttempts: 3
  });
  const chapterJob = mutableJob("chapters-job", {
    manuscriptId,
    type: "summarizeChapters",
    status: PIPELINE_JOB_STATUS.BLOCKED,
    idempotencyKey: "chapters-job",
    dependencyIds: [summarizeJob.id],
    maxAttempts: 3
  });
  const jobs = [summarizeJob, chapterJob];
  const chunks = summarizeChunkFixtures(manuscriptId, 3);
  const outputs: Array<Record<string, unknown>> = [];

  delete process.env.OPENAI_API_KEY;

  try {
    await withPatchedPrisma(
      summarizeChunksPatches({ manuscriptId, run, jobs, chunks, outputs }),
      async () => {
        const first = await runPipelineJob(summarizeJob.id, {
          maxItemsPerStep: 1,
          workerId: "test:repeat-1"
        });
        const second = await runPipelineJob(summarizeJob.id, {
          maxItemsPerStep: 1,
          workerId: "test:repeat-2"
        });
        const third = await runPipelineJob(summarizeJob.id, {
          maxItemsPerStep: 1,
          workerId: "test:repeat-3"
        });

        assert.equal(first.status, "queued");
        assert.equal(second.status, "queued");
        assert.equal(third.status, "completed");
        assert.deepEqual(
          outputs.map((output) => output.scopeId),
          ["chunk-1", "chunk-2", "chunk-3"]
        );
        assert.equal(summarizeJob.status, PIPELINE_JOB_STATUS.COMPLETED);
        assert.deepEqual(summarizeJob.result, {
          analyzed: 1,
          remaining: 0,
          complete: true
        });
        assert.equal(chapterJob.status, PIPELINE_JOB_STATUS.QUEUED);
        assert.deepEqual(third.readyJobIds, [chapterJob.id]);

        const checkpoint = normalizeCheckpoint(run.checkpoint);
        assert.equal(isStepComplete(checkpoint, "summarizeChunks"), true);
        assert.equal(checkpoint.currentStep ?? undefined, undefined);
        assert.equal(
          (checkpoint.stepMetadata?.summarizeChunks as Record<string, unknown>)
            .remaining,
          0
        );
      }
    );
  } finally {
    restoreEnv("OPENAI_API_KEY", oldApiKey);
  }
});

test("repeated extractNarrativeMemory partial runs finish and unblock compileChapterCapsules", async () => {
  const manuscriptId = "manuscript-narrative-memory-partial";
  const run = mutableRun(manuscriptId, {
    completedSteps: [
      "parseAndNormalizeManuscript",
      "splitIntoChapters",
      "splitIntoChunks",
      "createEmbeddingsForChunks",
      "summarizeChunks",
      "summarizeChapters",
      "createManuscriptProfile",
      "buildManuscriptNodes",
      "compileSceneDigests"
    ],
    currentStep: "extractNarrativeMemory"
  });
  const extractJob = mutableJob("extract-memory-job", {
    manuscriptId,
    type: "extractNarrativeMemory",
    status: PIPELINE_JOB_STATUS.QUEUED,
    idempotencyKey: "extract-memory-job",
    maxAttempts: 3
  });
  const capsuleJob = mutableJob("chapter-capsules-job", {
    manuscriptId,
    type: "compileChapterCapsules",
    status: PIPELINE_JOB_STATUS.BLOCKED,
    idempotencyKey: "chapter-capsules-job",
    dependencyIds: [extractJob.id],
    maxAttempts: 3
  });
  const jobs = [extractJob, capsuleJob];
  const artifacts = sceneDigestArtifactFixtures(manuscriptId, 6);
  const memory = {
    facts: [] as Array<Record<string, unknown>>,
    characters: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
    styles: [] as Array<Record<string, unknown>>
  };

  await withPatchedPrisma(
    narrativeMemoryJobPatches({ manuscriptId, run, jobs, artifacts, memory }),
    async () => {
      const first = await runPipelineJob(extractJob.id, {
        maxItemsPerStep: 4,
        workerId: "test:extract-1"
      });

      assert.equal(first.status, "queued");
      assert.deepEqual(extractJob.result, {
        refreshed: 4,
        total: 6,
        remaining: 2,
        complete: false
      });
      assert.deepEqual(first.readyJobIds, [extractJob.id]);
      assert.equal(capsuleJob.status, PIPELINE_JOB_STATUS.BLOCKED);

      const second = await runPipelineJob(extractJob.id, {
        maxItemsPerStep: 4,
        workerId: "test:extract-2"
      });

      assert.equal(second.status, "completed");
      assert.deepEqual(extractJob.result, {
        refreshed: 2,
        total: 6,
        remaining: 0,
        complete: true
      });
      assert.equal(extractJob.status, PIPELINE_JOB_STATUS.COMPLETED);
      assert.equal(capsuleJob.status, PIPELINE_JOB_STATUS.QUEUED);
      assert.deepEqual(second.readyJobIds, [capsuleJob.id]);
      assert.deepEqual(
        memory.facts.map((fact) => recordValue(fact.metadata)?.sourceArtifactId),
        [
          "scene-digest-artifact-1",
          "scene-digest-artifact-2",
          "scene-digest-artifact-3",
          "scene-digest-artifact-4",
          "scene-digest-artifact-5",
          "scene-digest-artifact-6"
        ]
      );

      const checkpoint = normalizeCheckpoint(run.checkpoint);
      assert.equal(isStepComplete(checkpoint, "extractNarrativeMemory"), true);
      assert.equal(checkpoint.currentStep ?? undefined, undefined);
      assert.equal(
        (checkpoint.stepMetadata?.extractNarrativeMemory as Record<string, unknown>)
          .remaining,
        0
      );
    }
  );
});

test("repeated compileChapterCapsules partial runs finish and unblock compileWholeBookMap", async () => {
  const manuscriptId = "manuscript-chapter-capsules-partial";
  const run = mutableRun(manuscriptId, {
    completedSteps: [
      "parseAndNormalizeManuscript",
      "splitIntoChapters",
      "splitIntoChunks",
      "createEmbeddingsForChunks",
      "summarizeChunks",
      "summarizeChapters",
      "createManuscriptProfile",
      "buildManuscriptNodes",
      "compileSceneDigests",
      "extractNarrativeMemory"
    ],
    currentStep: "compileChapterCapsules"
  });
  const capsuleJob = mutableJob("chapter-capsules-job", {
    manuscriptId,
    type: "compileChapterCapsules",
    status: PIPELINE_JOB_STATUS.QUEUED,
    idempotencyKey: "chapter-capsules-job",
    maxAttempts: 3
  });
  const wholeBookJob = mutableJob("whole-book-map-job", {
    manuscriptId,
    type: "compileWholeBookMap",
    status: PIPELINE_JOB_STATUS.BLOCKED,
    idempotencyKey: "whole-book-map-job",
    dependencyIds: [capsuleJob.id],
    maxAttempts: 3
  });
  const jobs = [capsuleJob, wholeBookJob];
  const db = chapterCapsulePipelineDb(manuscriptId, 6);
  const requests: Array<Record<string, unknown>> = [];
  const restoreOpenAI = setOpenAIClientForTest(
    fakeOpenAIClient(requests, {
      chapterSummary: "Compiled chapter summary.",
      chapterFunction: "Moves the manuscript forward.",
      characterMovement: {},
      plotMovement: {},
      pacingAssessment: "Steady.",
      continuityRisks: [],
      styleFingerprint: {},
      revisionPressure: "low",
      mustPreserve: [],
      suggestedEditorialFocus: []
    })
  );

  try {
    await withPatchedPrisma(
      chapterCapsuleJobPatches({ manuscriptId, run, jobs, db }),
      async () => {
        const first = await runPipelineJob(capsuleJob.id, {
          maxItemsPerStep: 2,
          workerId: "test:capsules-1"
        });

        assert.equal(first.status, "queued");
        assert.deepEqual(capsuleJob.result, {
          compiled: 2,
          total: 6,
          remaining: 4,
          complete: false
        });
        assert.deepEqual(first.readyJobIds, [capsuleJob.id]);
        assert.equal(wholeBookJob.status, PIPELINE_JOB_STATUS.BLOCKED);

        const second = await runPipelineJob(capsuleJob.id, {
          maxItemsPerStep: 2,
          workerId: "test:capsules-2"
        });

        assert.equal(second.status, "queued");
        assert.deepEqual(capsuleJob.result, {
          compiled: 2,
          total: 6,
          remaining: 2,
          complete: false
        });
        assert.deepEqual(second.readyJobIds, [capsuleJob.id]);
        assert.equal(wholeBookJob.status, PIPELINE_JOB_STATUS.BLOCKED);

        const third = await runPipelineJob(capsuleJob.id, {
          maxItemsPerStep: 2,
          workerId: "test:capsules-3"
        });

        assert.equal(third.status, "completed");
        assert.deepEqual(capsuleJob.result, {
          compiled: 2,
          total: 6,
          remaining: 0,
          complete: true
        });
        assert.equal(capsuleJob.status, PIPELINE_JOB_STATUS.COMPLETED);
        assert.equal(wholeBookJob.status, PIPELINE_JOB_STATUS.QUEUED);
        assert.deepEqual(third.readyJobIds, [wholeBookJob.id]);

        const fourth = await runPipelineJob(capsuleJob.id, {
          maxItemsPerStep: 2,
          workerId: "test:capsules-4"
        });

        assert.equal(fourth.status, "completed");
        assert.equal(requests.length, 6);

        const capsules = db.artifacts.filter(
          (artifact) => artifact.artifactType === "CHAPTER_CAPSULE"
        );
        assert.equal(capsules.length, 6);
        assert.equal(
          new Set(capsules.map((artifact) => artifact.chapterId)).size,
          6
        );

        const checkpoint = normalizeCheckpoint(run.checkpoint);
        assert.equal(isStepComplete(checkpoint, "compileChapterCapsules"), true);
        assert.equal(checkpoint.currentStep ?? undefined, undefined);
        assert.equal(
          (
            checkpoint.stepMetadata?.compileChapterCapsules as Record<
              string,
              unknown
            >
          ).remaining,
          0
        );
      }
    );
  } finally {
    restoreOpenAI();
  }
});

test("manual ready runner pauses after one partial compileChapterCapsules batch", async () => {
  const manuscriptId = "manuscript-chapter-capsules-manual-partial";
  const run = mutableRun(manuscriptId, {
    completedSteps: [
      "parseAndNormalizeManuscript",
      "splitIntoChapters",
      "splitIntoChunks",
      "createEmbeddingsForChunks",
      "summarizeChunks",
      "summarizeChapters",
      "createManuscriptProfile",
      "buildManuscriptNodes",
      "compileSceneDigests",
      "extractNarrativeMemory"
    ],
    currentStep: "compileChapterCapsules"
  });
  const capsuleJob = mutableJob("chapter-capsules-job", {
    manuscriptId,
    type: "compileChapterCapsules",
    status: PIPELINE_JOB_STATUS.QUEUED,
    idempotencyKey: pipelineStepJobKey(manuscriptId, "compileChapterCapsules"),
    maxAttempts: 3
  });
  const wholeBookJob = mutableJob("whole-book-map-job", {
    manuscriptId,
    type: "compileWholeBookMap",
    status: PIPELINE_JOB_STATUS.BLOCKED,
    idempotencyKey: pipelineStepJobKey(manuscriptId, "compileWholeBookMap"),
    dependencyIds: [capsuleJob.id],
    maxAttempts: 3
  });
  const jobs = [capsuleJob, wholeBookJob];
  const db = chapterCapsulePipelineDb(manuscriptId, 6);
  const requests: Array<Record<string, unknown>> = [];
  const restoreOpenAI = setOpenAIClientForTest(
    fakeOpenAIClient(requests, chapterCapsuleJson())
  );

  try {
    await withPatchedPrisma(
      chapterCapsuleJobPatches({ manuscriptId, run, jobs, db }),
      async () => {
        const first = await runReadyPipelineJobs({
          manuscriptId,
          maxJobs: 5,
          maxSeconds: 20,
          maxItemsPerStep: 2,
          workerType: "MANUAL",
          workerId: "test:manual-capsules-1"
        });

        assert.equal(first.jobsRun, 1);
        assert.equal(first.results[0]?.status, "queued");
        assert.equal(requests.length, 2);
        assert.equal(capsuleJob.status, PIPELINE_JOB_STATUS.QUEUED);
        assert.deepEqual(capsuleJob.result, {
          compiled: 2,
          total: 6,
          remaining: 4,
          complete: false
        });
        assert.equal(capsuleJob.lockedAt, null);
        assert.equal(capsuleJob.lockedBy, null);
        assert.equal(capsuleJob.lockExpiresAt, null);
        assert.equal(wholeBookJob.status, PIPELINE_JOB_STATUS.BLOCKED);

        const second = await runReadyPipelineJobs({
          manuscriptId,
          maxJobs: 5,
          maxSeconds: 20,
          maxItemsPerStep: 2,
          workerType: "MANUAL",
          workerId: "test:manual-capsules-2"
        });

        assert.equal(second.jobsRun, 1);
        assert.equal(second.results[0]?.jobId, capsuleJob.id);
        assert.equal(second.results[0]?.status, "queued");
        assert.equal(requests.length, 4);
        assert.deepEqual(capsuleJob.result, {
          compiled: 2,
          total: 6,
          remaining: 2,
          complete: false
        });

        const third = await runReadyPipelineJobs({
          manuscriptId,
          maxJobs: 1,
          maxSeconds: 20,
          maxItemsPerStep: 2,
          workerType: "MANUAL",
          workerId: "test:manual-capsules-3"
        });

        assert.equal(third.jobsRun, 1);
        assert.equal(third.results[0]?.status, "completed");
        assert.equal(requests.length, 6);
        assert.equal(capsuleJob.status, PIPELINE_JOB_STATUS.COMPLETED);
        assert.equal(wholeBookJob.status, PIPELINE_JOB_STATUS.QUEUED);
        assert.deepEqual(third.readyJobIds, [wholeBookJob.id]);
      }
    );
  } finally {
    restoreOpenAI();
  }
});

test("manual ready runner continues runChapterAudits batches into whole book audit", async () => {
  const manuscriptId = "manuscript-late-audit-continuation";
  const oldApiKey = process.env.OPENAI_API_KEY;
  const run = mutableRun(manuscriptId, checkpointBeforeRunChapterAudits());
  const jobs: MutableJob[] = [];
  const auditJob = mutableJob("chapter-audits-job", {
    manuscriptId,
    type: "runChapterAudits",
    status: PIPELINE_JOB_STATUS.QUEUED,
    idempotencyKey: pipelineStepJobKey(manuscriptId, "runChapterAudits"),
    maxAttempts: 3
  });
  const wholeBookJob = mutableJob("whole-book-job", {
    manuscriptId,
    type: "runWholeBookAudit",
    status: PIPELINE_JOB_STATUS.BLOCKED,
    idempotencyKey: pipelineStepJobKey(manuscriptId, "runWholeBookAudit"),
    dependencyIds: [auditJob.id],
    maxAttempts: 3
  });
  jobs.push(auditJob, wholeBookJob);
  const chapters = chapterAuditFixtures(manuscriptId, 5);
  const outputs: Array<Record<string, unknown>> = [];
  const reports: Array<Record<string, unknown>> = [];

  delete process.env.OPENAI_API_KEY;

  try {
    await withPatchedPrisma(
      chapterAuditPatches({ manuscriptId, run, jobs, chapters, outputs, reports }),
      async () => {
        const result = await runReadyPipelineJobs({
          manuscriptId,
          maxJobs: 4,
          maxSeconds: 30,
          maxItemsPerStep: 2,
          workerType: "MANUAL",
          workerId: "test:manual-late-audits"
        });

        assert.equal(result.jobsRun, 4);
        assert.deepEqual(
          result.results.map((item) => `${item.type}:${item.status}`),
          [
            "runChapterAudits:queued",
            "runChapterAudits:queued",
            "runChapterAudits:completed",
            "runWholeBookAudit:completed"
          ]
        );
        assert.equal(auditJob.status, PIPELINE_JOB_STATUS.COMPLETED);
        assert.equal(wholeBookJob.status, PIPELINE_JOB_STATUS.COMPLETED);
        assert.deepEqual(auditJob.result, {
          audited: 5,
          processed: 1,
          total: 5,
          remaining: 0,
          complete: true
        });
        assert.equal(
          outputs.filter((output) => output.passType === "CHAPTER_AUDIT").length,
          5
        );
        assert.equal(
          outputs.some((output) => output.passType === "WHOLE_BOOK_AUDIT"),
          true
        );
        assert.equal(reports.length, 1);
      }
    );
  } finally {
    restoreEnv("OPENAI_API_KEY", oldApiKey);
  }
});

test("stale running compileWholeBookMap recovers and unblocks next editorial actions", async () => {
  const manuscriptId = "manuscript-stale-whole-book-map";
  const oldVercelEnv = process.env.VERCEL_ENV;
  const oldOpenAIKey = process.env.OPENAI_API_KEY;
  const run = mutableRun(manuscriptId, {
    completedSteps: [
      "parseAndNormalizeManuscript",
      "splitIntoChapters",
      "splitIntoChunks",
      "createEmbeddingsForChunks",
      "summarizeChunks",
      "summarizeChapters",
      "createManuscriptProfile",
      "buildManuscriptNodes",
      "compileSceneDigests",
      "extractNarrativeMemory",
      "compileChapterCapsules"
    ],
    currentStep: "compileWholeBookMap"
  });
  const wholeBookJob = mutableJob("whole-book-map-job", {
    manuscriptId,
    type: "compileWholeBookMap",
    status: PIPELINE_JOB_STATUS.RUNNING,
    idempotencyKey: pipelineStepJobKey(manuscriptId, "compileWholeBookMap"),
    attempts: 2,
    maxAttempts: 3,
    error: "Job lock expired before completion.",
    lockedAt: new Date("2026-04-29T04:50:00Z"),
    lockedBy: "manual:stale-whole-book",
    lockExpiresAt: new Date("2026-04-29T04:59:00Z")
  });
  const nextActionsJob = mutableJob("next-actions-job", {
    manuscriptId,
    type: "createNextBestEditorialActions",
    status: PIPELINE_JOB_STATUS.BLOCKED,
    idempotencyKey: pipelineStepJobKey(
      manuscriptId,
      "createNextBestEditorialActions"
    ),
    dependencyIds: [wholeBookJob.id],
    maxAttempts: 3
  });
  const jobs = [wholeBookJob, nextActionsJob];
  const db = chapterCapsulePipelineDb(manuscriptId, 3);
  const requests: Array<Record<string, unknown>> = [];
  const restoreOpenAI = setOpenAIClientForTest(
    fakeOpenAIClient(requests, wholeBookMapJson())
  );
  seedChapterCapsuleArtifacts(db);
  process.env.VERCEL_ENV = "preview";
  process.env.OPENAI_API_KEY = "test-openai-key";

  try {
    await withPatchedPrisma(
      chapterCapsuleJobPatches({ manuscriptId, run, jobs, db }),
      async () => {
        const result = await runReadyPipelineJobs({
          manuscriptId,
          maxJobs: 2,
          maxSeconds: 20,
          maxItemsPerStep: 2,
          workerType: "MANUAL",
          workerId: "test:manual-stale-whole-book"
        });
        const wholeBookMaps = db.artifacts.filter(
          (artifact) => artifact.artifactType === "WHOLE_BOOK_MAP"
        );

        assert.equal(result.recoveredStaleJobs[0]?.id, wholeBookJob.id);
        assert.equal(result.jobsRun, 2);
        assert.equal(result.results[0]?.jobId, wholeBookJob.id);
        assert.equal(result.results[0]?.status, "completed");
        assert.equal(result.results[1]?.jobId, nextActionsJob.id);
        assert.equal(result.results[1]?.status, "completed");
        assert.equal(wholeBookJob.status, PIPELINE_JOB_STATUS.COMPLETED);
        assert.equal(wholeBookJob.error, null);
        assert.equal(wholeBookJob.lockedAt, null);
        assert.equal(wholeBookJob.lockedBy, null);
        assert.equal(wholeBookJob.lockExpiresAt, null);
        assert.deepEqual(wholeBookJob.result, {
          wholeBookMap: true,
          fallback: true,
          complete: true
        });
        assert.equal(nextActionsJob.status, PIPELINE_JOB_STATUS.COMPLETED);
        assert.equal(result.readyJobIds.includes(nextActionsJob.id), true);
        assert.equal(requests.length, 0);
        assert.equal(wholeBookMaps.length, 1);
        assert.equal(wholeBookMaps[0].model, "stub");
        assert.equal(
          db.artifacts.filter(
            (artifact) => artifact.artifactType === "NEXT_BEST_ACTIONS"
          ).length,
          1
        );
      }
    );
  } finally {
    restoreOpenAI();
    restoreEnv("VERCEL_ENV", oldVercelEnv);
    restoreEnv("OPENAI_API_KEY", oldOpenAIKey);
  }
});

test("stale running partial step is recovered as queued and can resume", async () => {
  const manuscriptId = "manuscript-stale-partial-capsules";
  const run = mutableRun(manuscriptId, {
    completedSteps: [
      "parseAndNormalizeManuscript",
      "splitIntoChapters",
      "splitIntoChunks",
      "createEmbeddingsForChunks",
      "summarizeChunks",
      "summarizeChapters",
      "createManuscriptProfile",
      "buildManuscriptNodes",
      "compileSceneDigests",
      "extractNarrativeMemory"
    ],
    currentStep: "compileChapterCapsules"
  });
  const capsuleJob = mutableJob("chapter-capsules-job", {
    manuscriptId,
    type: "compileChapterCapsules",
    status: PIPELINE_JOB_STATUS.RUNNING,
    idempotencyKey: pipelineStepJobKey(manuscriptId, "compileChapterCapsules"),
    result: {
      compiled: 2,
      total: 6,
      remaining: 4,
      complete: false
    },
    attempts: 2,
    maxAttempts: 3,
    lockedAt: new Date("2026-04-29T04:50:00Z"),
    lockedBy: "manual:stale",
    lockExpiresAt: new Date("2026-04-29T04:59:00Z")
  });
  const wholeBookJob = mutableJob("whole-book-map-job", {
    manuscriptId,
    type: "compileWholeBookMap",
    status: PIPELINE_JOB_STATUS.BLOCKED,
    idempotencyKey: pipelineStepJobKey(manuscriptId, "compileWholeBookMap"),
    dependencyIds: [capsuleJob.id],
    maxAttempts: 3
  });
  const jobs = [capsuleJob, wholeBookJob];
  const db = chapterCapsulePipelineDb(manuscriptId, 6);
  const requests: Array<Record<string, unknown>> = [];
  const restoreOpenAI = setOpenAIClientForTest(
    fakeOpenAIClient(requests, chapterCapsuleJson())
  );

  try {
    await withPatchedPrisma(
      chapterCapsuleJobPatches({ manuscriptId, run, jobs, db }),
      async () => {
        const recovered = await releaseStaleLocks(manuscriptId);

        assert.deepEqual(
          recovered.map((job) => job.id),
          [capsuleJob.id]
        );
        assert.equal(capsuleJob.status, PIPELINE_JOB_STATUS.QUEUED);
        assert.equal(capsuleJob.error, null);
        assert.equal(capsuleJob.readyAt, null);
        assert.equal(capsuleJob.lockedAt, null);
        assert.equal(capsuleJob.lockedBy, null);
        assert.equal(capsuleJob.lockExpiresAt, null);
        assert.equal(capsuleJob.attempts, 1);

        const retry = await runReadyPipelineJobs({
          manuscriptId,
          maxJobs: 5,
          maxSeconds: 20,
          maxItemsPerStep: 2,
          workerType: "MANUAL",
          workerId: "test:manual-stale-capsules"
        });

        assert.equal(retry.jobsRun, 1);
        assert.equal(retry.results[0]?.jobId, capsuleJob.id);
        assert.equal(retry.results[0]?.status, "queued");
        assert.equal(requests.length, 2);
        assert.equal(capsuleJob.status, PIPELINE_JOB_STATUS.QUEUED);
        assert.equal(capsuleJob.lockedAt, null);
        assert.equal(capsuleJob.lockedBy, null);
        assert.equal(capsuleJob.lockExpiresAt, null);
        assert.deepEqual(capsuleJob.result, {
          compiled: 2,
          total: 6,
          remaining: 4,
          complete: false
        });
      }
    );
  } finally {
    restoreOpenAI();
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

test("manual final synthesis locks use the short import-safe stale window", () => {
  const now = new Date("2026-04-29T05:00:00Z");

  assert.equal(
    isLockStale(
      {
        type: "runWholeBookAudit",
        status: PIPELINE_JOB_STATUS.RUNNING,
        lockedBy: "manual:manuscript:test",
        lockedAt: new Date(now.getTime() - MANUAL_FINAL_SYNTHESIS_LOCK_MS + 1000),
        lockExpiresAt: new Date(now.getTime() + 8 * 60 * 1000)
      },
      now
    ),
    false
  );
  assert.equal(
    isLockStale(
      {
        type: "runWholeBookAudit",
        status: PIPELINE_JOB_STATUS.RUNNING,
        lockedBy: "manual:manuscript:test",
        lockedAt: new Date(now.getTime() - MANUAL_FINAL_SYNTHESIS_LOCK_MS - 1000),
        lockExpiresAt: new Date(now.getTime() + 8 * 60 * 1000)
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
    pipelineStartHttpStatus({ executionMode: "QUEUED", accepted: true }),
    202
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

function checkpointBeforeRunChapterAudits() {
  return {
    completedSteps: [
      "parseAndNormalizeManuscript",
      "splitIntoChapters",
      "splitIntoChunks",
      "createEmbeddingsForChunks",
      "summarizeChunks",
      "summarizeChapters",
      "createManuscriptProfile",
      "buildManuscriptNodes",
      "compileSceneDigests",
      "extractNarrativeMemory",
      "compileChapterCapsules",
      "compileWholeBookMap",
      "createNextBestEditorialActions"
    ],
    currentStep: "runChapterAudits"
  };
}

function manuscriptRunnerPatches(input: {
  manuscriptId: string;
  run: MutableRun;
  jobs: MutableJob[];
}): Array<[object, Record<string, unknown>]> {
  return [
    [
      prisma.manuscript,
      {
        findUnique: async () => ({ id: input.manuscriptId }),
        findUniqueOrThrow: async () => ({
          id: input.manuscriptId,
          title: "Test Manuscript",
          targetGenre: "Fantasy",
          targetAudience: "Adult",
          chapters: [],
          chunks: []
        }),
        update: async (args: { data: Record<string, unknown> }) => ({
          id: input.manuscriptId,
          ...args.data
        })
      }
    ],
    [prisma.analysisRun, analysisRunPatch(input.run)],
    [prisma.pipelineJob, pipelineJobPatch(input.jobs)],
    [
      prisma.workerHeartbeat,
      {
        upsert: async (args: { update: Record<string, unknown> }) => args.update
      }
    ]
  ];
}

function narrativeMemoryJobPatches(input: {
  manuscriptId: string;
  run: MutableRun;
  jobs: MutableJob[];
  artifacts: Array<Record<string, unknown>>;
  memory: {
    facts: Array<Record<string, unknown>>;
    characters: Array<Record<string, unknown>>;
    events: Array<Record<string, unknown>>;
    styles: Array<Record<string, unknown>>;
  };
}): Array<[object, Record<string, unknown>]> {
  const tx = narrativeMemoryTransaction(input.memory);

  return [
    ...manuscriptRunnerPatches({
      manuscriptId: input.manuscriptId,
      run: input.run,
      jobs: input.jobs
    }),
    [
      prisma,
      {
        $transaction: async (
          callback: (transactionClient: typeof tx) => Promise<unknown>
        ) => callback(tx)
      }
    ],
    [
      prisma.compilerArtifact,
      {
        findMany: async (args: { where?: Record<string, unknown> } = {}) =>
          input.artifacts.filter((artifact) => matchesWhere(artifact, args.where))
      }
    ],
    [prisma.narrativeFact, tx.narrativeFact],
    [prisma.characterState, tx.characterState],
    [prisma.plotEvent, tx.plotEvent],
    [prisma.styleFingerprint, tx.styleFingerprint]
  ];
}

function narrativeMemoryTransaction(memory: {
  facts: Array<Record<string, unknown>>;
  characters: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  styles: Array<Record<string, unknown>>;
}) {
  return {
    narrativeFact: narrativeMemoryDelegate(memory.facts),
    characterState: narrativeMemoryDelegate(memory.characters),
    plotEvent: narrativeMemoryDelegate(memory.events),
    styleFingerprint: narrativeStyleFingerprintDelegate(memory.styles)
  };
}

function narrativeMemoryDelegate(rows: Array<Record<string, unknown>>) {
  return {
    findMany: async (args: { where?: Record<string, unknown> } = {}) =>
      rows.filter((row) => matchesWhere(row, args.where)),
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

function narrativeStyleFingerprintDelegate(rows: Array<Record<string, unknown>>) {
  return {
    findMany: async (args: { where?: Record<string, unknown> } = {}) =>
      rows.filter((row) => matchesWhere(row, args.where)),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) => {
      const before = rows.length;
      const remaining = rows.filter((row) => !matchesWhere(row, args.where));
      rows.splice(0, rows.length, ...remaining);
      return { count: before - rows.length };
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const row = { id: `style-${rows.length + 1}`, ...args.data };
      rows.push(row);
      return row;
    }
  };
}

function sceneDigestArtifactFixtures(manuscriptId: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const item = index + 1;

    return {
      id: `scene-digest-artifact-${item}`,
      manuscriptId,
      nodeId: `scene-node-${item}`,
      chapterId: "chapter-1",
      sceneId: `scene-${item}`,
      artifactType: "SCENE_DIGEST",
      model: "stub",
      reasoningEffort: "none",
      promptVersion: "compiler-v1",
      inputHash: `scene-digest-${item}`,
      output: {
        summary: `Scene ${item} summary.`,
        continuityFacts: [{ factText: `Fact ${item}.` }],
        characterAppearances: [],
        keyEvents: [],
        styleNotes: ["Direct prose"],
        mustNotForget: []
      },
      rawText: "{}",
      status: "COMPLETED",
      error: null,
      createdAt: new Date(`2026-05-01T08:00:0${item}Z`)
    };
  });
}

function chapterCapsulePipelineDb(manuscriptId: string, chapterCount: number) {
  const chapters = Array.from({ length: chapterCount }, (_, index) => {
    const item = index + 1;

    return {
      id: `chapter-${item}`,
      manuscriptId,
      order: item,
      chapterIndex: item,
      title: `Chapter ${item}`,
      heading: `Chapter ${item}`,
      text: `Chapter ${item} source text.`,
      summary: null as string | null,
      wordCount: 4,
      status: "CHAPTER_READY",
      startOffset: 0,
      endOffset: 24,
      createdAt: new Date(`2026-05-01T08:00:0${item}Z`)
    };
  });
  const nodes = chapters.map((chapter) => ({
    id: `chapter-node-${chapter.order}`,
    key: `node:chapter:${chapter.order}`,
    manuscriptId,
    type: "CHAPTER",
    chapterId: chapter.id
  }));
  const sceneDigests = chapters.map((chapter) => ({
    id: `scene-digest-${chapter.order}`,
    manuscriptId,
    nodeId: `scene-node-${chapter.order}`,
    chapterId: chapter.id,
    sceneId: `scene-${chapter.order}`,
    artifactType: "SCENE_DIGEST",
    model: "stub",
    reasoningEffort: "none",
    promptVersion: "compiler-v1",
    inputHash: `scene-digest-hash-${chapter.order}`,
    output: {
      summary: `Scene summary ${chapter.order}.`,
      continuityFacts: [],
      characterAppearances: [],
      keyEvents: [],
      styleNotes: []
    },
    rawText: "{}",
    status: "COMPLETED",
    error: null,
    createdAt: new Date(`2026-05-01T09:00:0${chapter.order}Z`)
  }));

  return {
    manuscript: {
      id: manuscriptId,
      title: "Capsule Pipeline Manuscript",
      targetGenre: "Fantasy",
      targetAudience: "Adult",
      chapterCount,
      chunkCount: chapterCount,
      status: "IMPORTED",
      analysisStatus: "QUEUED",
      profile: {
        wordCount: chapterCount * 4,
        chapterCount,
        avgChapterWords: 4,
        dialogueRatio: 0,
        expositionRatio: 0.4,
        actionRatio: 0.4,
        pacingCurve: [],
        styleFingerprint: {}
      }
    },
    chapters,
    nodes,
    artifacts: [...sceneDigests] as Array<Record<string, unknown>>,
    facts: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
    findings: [] as Array<Record<string, unknown>>,
    decisions: [] as Array<Record<string, unknown>>
  };
}

function seedChapterCapsuleArtifacts(
  db: ReturnType<typeof chapterCapsulePipelineDb>
) {
  db.artifacts.push(
    ...db.chapters.map((chapter) => ({
      id: `chapter-capsule-${chapter.order}`,
      manuscriptId: db.manuscript.id,
      nodeId: `chapter-node-${chapter.order}`,
      chapterId: chapter.id,
      sceneId: null,
      artifactType: "CHAPTER_CAPSULE",
      model: "stub",
      reasoningEffort: "none",
      promptVersion: "compiler-v1",
      inputHash: `chapter-capsule-hash-${chapter.order}`,
      output: {
        chapterSummary: `Chapter ${chapter.order} summary.`,
        chapterFunction: "Moves the manuscript forward.",
        continuityRisks: [],
        suggestedEditorialFocus: []
      },
      rawText: "{}",
      status: "COMPLETED",
      error: null,
      createdAt: new Date(`2026-05-01T10:00:0${chapter.order}Z`)
    }))
  );
}

function chapterCapsuleJobPatches(input: {
  manuscriptId: string;
  run: MutableRun;
  jobs: MutableJob[];
  db: ReturnType<typeof chapterCapsulePipelineDb>;
}): Array<[object, Record<string, unknown>]> {
  return [
    ...manuscriptRunnerPatches({
      manuscriptId: input.manuscriptId,
      run: input.run,
      jobs: input.jobs
    }),
    [
      prisma.manuscript,
      {
        findUnique: async () => input.db.manuscript,
        findUniqueOrThrow: async () => ({
          ...input.db.manuscript,
          chapters: input.db.chapters,
          profile: input.db.manuscript.profile
        }),
        update: async (args: { data: Record<string, unknown> }) => {
          Object.assign(input.db.manuscript, args.data);
          return input.db.manuscript;
        }
      }
    ],
    [
      prisma.compilerArtifact,
      {
        findMany: async (args: { where?: Record<string, unknown> } = {}) =>
          input.db.artifacts.filter((artifact) =>
            matchesWhere(artifact, args.where)
          ),
        findFirst: async (args: { where?: Record<string, unknown> } = {}) =>
          input.db.artifacts.find((artifact) =>
            matchesWhere(artifact, args.where)
          ) ?? null,
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
          const existing = input.db.artifacts.find(
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
            id: `artifact-${input.db.artifacts.length + 1}`,
            status: "COMPLETED",
            error: null,
            createdAt: new Date(),
            ...args.create
          };
          input.db.artifacts.push(artifact);
          return artifact;
        }
      }
    ],
    [
      prisma.narrativeFact,
      {
        findMany: async (args: { where?: Record<string, unknown> } = {}) =>
          input.db.facts.filter((fact) => matchesWhere(fact, args.where))
      }
    ],
    [
      prisma.plotEvent,
      {
        findMany: async (args: { where?: Record<string, unknown> } = {}) =>
          input.db.events.filter((event) => matchesWhere(event, args.where))
      }
    ],
    [
      prisma.finding,
      {
        findMany: async (args: { where?: Record<string, unknown> } = {}) =>
          input.db.findings.filter((finding) =>
            matchesWhere(finding, args.where)
          )
      }
    ],
    [
      prisma.rewritePlan,
      {
        findFirst: async () => null
      }
    ],
    [
      prisma.editorialDecision,
      {
        createMany: async (args: { data: Array<Record<string, unknown>> }) => {
          input.db.decisions.push(...args.data);
          return { count: args.data.length };
        }
      }
    ],
    [
      prisma.manuscriptNode,
      {
        findFirst: async (args: { where?: Record<string, unknown> } = {}) =>
          input.db.nodes.find((node) => matchesWhere(node, args.where)) ?? null,
        updateMany: async (args: {
          where?: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const nodes = input.db.nodes.filter((node) =>
            matchesWhere(node, args.where)
          );
          nodes.forEach((node) => Object.assign(node, args.data));
          return { count: nodes.length };
        }
      }
    ],
    [
      prisma.manuscriptChapter,
      {
        update: async (args: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const chapter = input.db.chapters.find(
            (candidate) => candidate.id === args.where.id
          );
          assert.ok(chapter);
          Object.assign(chapter, args.data);
          return chapter;
        }
      }
    ]
  ];
}

function summarizeChunksPatches(input: {
  manuscriptId: string;
  run: MutableRun;
  jobs: MutableJob[];
  chunks: Array<Record<string, unknown>>;
  outputs: Array<Record<string, unknown>>;
}): Array<[object, Record<string, unknown>]> {
  return [
    [
      prisma.manuscript,
      {
        findUniqueOrThrow: async () => ({
          id: input.manuscriptId,
          title: "Test Manuscript",
          targetGenre: "Fantasy",
          targetAudience: "Adult",
          chunks: input.chunks,
          chapters: [chapterFixture()]
        }),
        update: async (args: { data: Record<string, unknown> }) => ({
          id: input.manuscriptId,
          ...args.data
        })
      }
    ],
    [prisma.analysisRun, analysisRunPatch(input.run)],
    [prisma.pipelineJob, pipelineJobPatch(input.jobs)],
    [
      prisma.analysisOutput,
      {
        findUnique: async (args: {
          where: {
            runId_passType_scopeType_scopeId: {
              runId: string;
              passType: string;
              scopeType: string;
              scopeId: string;
            };
          };
        }) => {
          const key = args.where.runId_passType_scopeType_scopeId;
          return (
            input.outputs.find(
              (output) =>
                output.runId === key.runId &&
                output.passType === key.passType &&
                output.scopeType === key.scopeType &&
                output.scopeId === key.scopeId
            ) ?? null
          );
        },
        upsert: async (args: {
          where: {
            runId_passType_scopeType_scopeId: {
              runId: string;
              passType: string;
              scopeType: string;
              scopeId: string;
            };
          };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const key = args.where.runId_passType_scopeType_scopeId;
          const existing = input.outputs.find(
            (output) =>
              output.runId === key.runId &&
              output.passType === key.passType &&
              output.scopeType === key.scopeType &&
              output.scopeId === key.scopeId
          );

          if (existing) {
            Object.assign(existing, args.update);
            return existing;
          }

          const output = {
            id: `output-${input.outputs.length + 1}`,
            ...args.create
          };
          input.outputs.push(output);
          return output;
        }
      }
    ],
    [
      prisma.manuscriptChunk,
      {
        update: async (args: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const chunk = input.chunks.find(
            (candidate) => candidate.id === args.where.id
          );
          assert.ok(chunk);
          Object.assign(chunk, args.data);
          return chunk;
        }
      }
    ],
    [
      prisma.finding,
      {
        deleteMany: async () => ({ count: 0 }),
        createMany: async (args: { data: unknown[] }) => ({
          count: args.data.length
        })
      }
    ]
  ];
}

function chapterAuditPatches(input: {
  manuscriptId: string;
  run: MutableRun;
  jobs: MutableJob[];
  chapters: Array<Record<string, unknown>>;
  outputs: Array<Record<string, unknown>>;
  reports: Array<Record<string, unknown>>;
}): Array<[object, Record<string, unknown>]> {
  const chunks = input.chapters.map((chapter) => ({
    id: `chunk-${chapter.order}`,
    manuscriptId: input.manuscriptId,
    chapterId: chapter.id,
    sceneId: null,
    chunkIndex: chapter.order,
    text: `Chunk text for ${chapter.title}.`,
    wordCount: 5,
    summary: `Stored chunk summary for ${chapter.title}.`,
    localMetrics: null,
    embedding: null,
    chapter
  }));
  const manuscript = {
    id: input.manuscriptId,
    title: "Late Audit Manuscript",
    targetGenre: "Fantasy",
    targetAudience: "Adult",
    wordCount: input.chapters.length * 1200,
    chapterCount: input.chapters.length,
    metadata: null,
    profile: {
      id: "profile-1",
      manuscriptId: input.manuscriptId,
      wordCount: input.chapters.length * 1200,
      chapterCount: input.chapters.length,
      pacingCurve: []
    }
  };

  return [
    [
      prisma.manuscript,
      {
        findUnique: async () => manuscript,
        findUniqueOrThrow: async () => ({
          ...manuscript,
          chapters: input.chapters,
          chunks,
          profile: manuscript.profile
        }),
        update: async (args: { data: Record<string, unknown> }) => {
          Object.assign(manuscript, args.data);
          return manuscript;
        }
      }
    ],
    [prisma.analysisRun, analysisRunPatch(input.run)],
    [prisma.pipelineJob, pipelineJobPatch(input.jobs)],
    [
      prisma.workerHeartbeat,
      {
        upsert: async (args: { update: Record<string, unknown> }) => args.update
      }
    ],
    [
      prisma.analysisOutput,
      {
        findUnique: async (args: {
          where: {
            runId_passType_scopeType_scopeId: {
              runId: string;
              passType: string;
              scopeType: string;
              scopeId: string;
            };
          };
        }) => {
          const key = args.where.runId_passType_scopeType_scopeId;
          return (
            input.outputs.find(
              (output) =>
                output.runId === key.runId &&
                output.passType === key.passType &&
                output.scopeType === key.scopeType &&
                output.scopeId === key.scopeId
            ) ?? null
          );
        },
        upsert: async (args: {
          where: {
            runId_passType_scopeType_scopeId: {
              runId: string;
              passType: string;
              scopeType: string;
              scopeId: string;
            };
          };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const key = args.where.runId_passType_scopeType_scopeId;
          const existing = input.outputs.find(
            (output) =>
              output.runId === key.runId &&
              output.passType === key.passType &&
              output.scopeType === key.scopeType &&
              output.scopeId === key.scopeId
          );

          if (existing) {
            Object.assign(existing, args.update);
            return existing;
          }

          const output = {
            id: `output-${input.outputs.length + 1}`,
            ...args.create
          };
          input.outputs.push(output);
          return output;
        }
      }
    ],
    [
      prisma.manuscriptChapter,
      {
        update: async (args: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const chapter = input.chapters.find(
            (candidate) => candidate.id === args.where.id
          );
          assert.ok(chapter);
          Object.assign(chapter, args.data);
          return chapter;
        }
      }
    ],
    [
      prisma.finding,
      {
        deleteMany: async () => ({ count: 0 }),
        createMany: async (args: { data: unknown[] }) => ({
          count: args.data.length
        }),
        findMany: async () => []
      }
    ],
    [
      prisma.auditReport,
      {
        findUnique: async (args: { where: { runId: string } }) =>
          input.reports.find((report) => report.runId === args.where.runId) ??
          null,
        create: async (args: { data: Record<string, unknown> }) => {
          const report = {
            id: `audit-report-${input.reports.length + 1}`,
            ...args.data
          };
          input.reports.push(report);
          return report;
        }
      }
    ]
  ];
}

function chapterAuditFixtures(manuscriptId: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const item = index + 1;

    return {
      id: `chapter-${item}`,
      manuscriptId,
      title: `Chapter ${item}`,
      heading: `Chapter ${item}`,
      order: item,
      chapterIndex: item,
      text: `Chapter ${item} source text with enough words for deterministic analysis.`,
      wordCount: 12,
      summary: null,
      status: "SUMMARIZED",
      createdAt: new Date("2026-04-29T05:00:00Z"),
      updatedAt: new Date("2026-04-29T05:00:00Z")
    };
  });
}

function summarizeChunkFixtures(manuscriptId: string, count: number) {
  const chapter = chapterFixture();

  return Array.from({ length: count }, (_, index) => ({
    id: `chunk-${index + 1}`,
    manuscriptId,
    chapterId: chapter.id,
    sceneId: null,
    chunkIndex: index + 1,
    text: `Chunk ${index + 1} text with enough words for deterministic analysis.`,
    wordCount: 9,
    startParagraph: index + 1,
    endParagraph: index + 1,
    paragraphStart: index + 1,
    paragraphEnd: index + 1,
    tokenEstimate: 9,
    tokenCount: 9,
    metadata: null,
    localMetrics: null,
    summary: null,
    embedding: null,
    createdAt: new Date("2026-04-29T05:00:00Z"),
    chapter
  }));
}

function chapterFixture() {
  return {
    id: "chapter-1",
    manuscriptId: "manuscript",
    title: "Opening",
    order: 1,
    chapterIndex: 1,
    text: "Chapter text.",
    wordCount: 2,
    summary: null,
    status: "CHAPTER_READY",
    createdAt: new Date("2026-04-29T05:00:00Z"),
    updatedAt: new Date("2026-04-29T05:00:00Z")
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

function matchesWhere(item: Record<string, unknown>, where: Record<string, unknown> = {}) {
  if (!where) {
    return true;
  }

  const or = Array.isArray(where.OR) ? where.OR : [];
  if (or.length > 0 && !or.some((part) => matchesWhere(item, recordValue(part) ?? {}))) {
    return false;
  }

  for (const [key, expected] of Object.entries(where)) {
    if (key === "OR") {
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

  if (record.path && record.equals !== undefined) {
    return nestedValue(actual, record.path) === record.equals;
  }

  return Object.entries(record).every(([key, value]) =>
    matchesField(recordValue(actual)?.[key], value)
  );
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

function chapterCapsuleJson() {
  return {
    chapterSummary: "Compiled chapter summary.",
    chapterFunction: "Moves the manuscript forward.",
    characterMovement: {},
    plotMovement: {},
    pacingAssessment: "Steady.",
    continuityRisks: [],
    styleFingerprint: {},
    revisionPressure: "low",
    mustPreserve: [],
    suggestedEditorialFocus: []
  };
}

function wholeBookMapJson() {
  return {
    bookPremise: "A compact whole-book premise.",
    whatTheBookIsTryingToBe: "A complete editorial map.",
    structureMap: {},
    mainArc: {},
    characterArcs: {},
    themeMap: {},
    pacingCurve: {},
    continuityRiskMap: {},
    topStructuralIssues: [],
    topVoiceRisks: [],
    topCommercialRisks: [],
    revisionStrategy: "Proceed to next editorial actions.",
    confidence: 0.7,
    uncertainties: []
  };
}

function fakeOpenAIClient(
  requests: Array<Record<string, unknown>>,
  jsonResponse: unknown
): OpenAIClient {
  return {
    chat: {
      completions: {
        create: async (request: Record<string, unknown>) => {
          requests.push(request);
          return {
            choices: [{ message: { content: JSON.stringify(jsonResponse) } }]
          };
        }
      }
    },
    embeddings: {
      create: async () => ({ data: [{ embedding: [0.1] }] })
    }
  } as unknown as OpenAIClient;
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
