import test from "node:test";
import assert from "node:assert/strict";
import type { PipelineJob } from "@prisma/client";
import {
  CORPUS_PIPELINE_JOB_TYPES,
  corpusPipelineJobKey,
  ensureCorpusAnalysisJobs,
  getNextEligibleCorpusJob,
  getNextEligibleCorpusJobSelection,
  plannedCorpusPipelineJobs,
  shouldShowCorpusAnalysisAction,
  summarizeCorpusAnalysis,
  type CorpusPipelineJobType
} from "../lib/corpus/corpusAnalysisJobs";
import {
  corpusAnalysisExecutionMode,
  corpusAnalysisHttpStatus,
  startCorpusAnalysis,
  runNextEligibleCorpusJob
} from "../lib/corpus/startCorpusAnalysis";
import {
  buildCorpusProgressStatus,
  describeNextEligibleCorpusJob,
  describeNextEligibleCorpusJobSelection,
  getCorpusProgressAction,
  shouldPollCorpusStatus,
  staleWarningText,
  type CorpusProgressBuildInput
} from "../lib/corpus/corpusProgressShared";
import {
  areDependenciesComplete,
  canAttemptJob,
  dependencyIdsFromJson,
  PIPELINE_JOB_STATUS
} from "../lib/pipeline/jobRules";
import { prisma } from "../lib/prisma";

test("importing a corpus book plans the full analysis job chain", () => {
  const jobs = plannedCorpusPipelineJobs("book-1");

  assert.deepEqual(
    jobs.map((job) => job.type),
    [
      CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN,
      CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS,
      CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHUNK,
      CORPUS_PIPELINE_JOB_TYPES.CORPUS_EMBED,
      CORPUS_PIPELINE_JOB_TYPES.CORPUS_PROFILE,
      CORPUS_PIPELINE_JOB_TYPES.CORPUS_BENCHMARK_CHECK
    ]
  );
  assert.deepEqual(jobs[0].dependencyKeys, []);
  assert.deepEqual(jobs[1].dependencyKeys, [jobs[0].idempotencyKey]);
  assert.deepEqual(jobs[5].dependencyKeys, [jobs[4].idempotencyKey]);
});

test("run-analysis uses deterministic keys for missing jobs", () => {
  const jobs = plannedCorpusPipelineJobs("book-2");

  assert.equal(
    jobs[0].idempotencyKey,
    corpusPipelineJobKey("book-2", CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN)
  );
  assert.equal(
    jobs[3].idempotencyKey,
    corpusPipelineJobKey("book-2", CORPUS_PIPELINE_JOB_TYPES.CORPUS_EMBED)
  );
});

test("run-analysis does not duplicate existing job identities", () => {
  const first = plannedCorpusPipelineJobs("book-3");
  const second = plannedCorpusPipelineJobs("book-3");

  assert.deepEqual(
    second.map((job) => job.idempotencyKey),
    first.map((job) => job.idempotencyKey)
  );
  assert.equal(new Set(first.map((job) => job.idempotencyKey)).size, first.length);
});

test("Inngest event mode is selected when enabled", () => {
  assert.equal(
    corpusAnalysisExecutionMode({
      inngestEnabled: true,
      inngestConfigured: true,
      runFallbackWhenDisabled: true
    }),
    "INNGEST"
  );
  assert.equal(
    corpusAnalysisHttpStatus({ executionMode: "INNGEST", accepted: true }),
    202
  );
});

test("Inngest mode requires a configured worker", () => {
  assert.equal(
    corpusAnalysisExecutionMode({
      inngestEnabled: true,
      inngestConfigured: false,
      runFallbackWhenDisabled: true
    }),
    "MANUAL"
  );
  assert.equal(
    corpusAnalysisExecutionMode({
      inngestEnabled: true,
      inngestConfigured: false,
      runFallbackWhenDisabled: false
    }),
    "QUEUED"
  );
});

test("fallback mode remains available when Inngest is disabled", () => {
  assert.equal(
    corpusAnalysisExecutionMode({
      inngestEnabled: false,
      runFallbackWhenDisabled: true
    }),
    "MANUAL"
  );
  assert.equal(
    corpusAnalysisExecutionMode({
      inngestEnabled: false,
      runFallbackWhenDisabled: false
    }),
    "QUEUED"
  );
});

test("disabled Inngest explicit corpus resume runs the manual fallback", async () => {
  const oldEnabled = process.env.ENABLE_INNGEST_WORKER;
  const oldEventKey = process.env.INNGEST_EVENT_KEY;
  const oldSigningKey = process.env.INNGEST_SIGNING_KEY;
  const oldDev = process.env.INNGEST_DEV;
  const jobs = completedCorpusJobs("book-disabled-resume");
  const jobsByKey = new Map(jobs.map((job) => [job.idempotencyKey, job]));
  const pipelineUpdates: Array<{
    where: { id: string };
    data: Record<string, unknown>;
  }> = [];
  const heartbeats: Array<{
    where: { workerType: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }> = [];

  process.env.ENABLE_INNGEST_WORKER = "false";
  delete process.env.INNGEST_EVENT_KEY;
  delete process.env.INNGEST_SIGNING_KEY;
  delete process.env.INNGEST_DEV;

  try {
    await withPatchedPrisma(
      [
        [
          prisma.corpusBook,
          {
            findUnique: async () => corpusBookForEnsure("book-disabled-resume"),
            update: async (args: unknown) => args
          }
        ],
        [
          prisma.pipelineJob,
          {
            findFirst: async (args: {
              where?: { OR?: Array<{ idempotencyKey?: string }> };
            }) => {
              const key = args.where?.OR?.[0]?.idempotencyKey;
              return key ? jobsByKey.get(key) ?? null : null;
            },
            findMany: async (args: {
              where?: { id?: { in?: string[] }; status?: string | { in?: string[] } };
            }) => filterCorpusJobsForTest(jobs, args.where),
            update: async (args: {
              where: { id: string };
              data: Record<string, unknown>;
            }) => {
              pipelineUpdates.push(args);
              const job = jobs.find((candidate) => candidate.id === args.where.id);
              assert.ok(job, `Expected job ${args.where.id} to exist`);
              Object.assign(job, args.data, { updatedAt: new Date() });
              return job;
            },
            create: async () => {
              throw new Error("Completed corpus jobs should already exist.");
            }
          }
        ],
        [
          prisma.workerHeartbeat,
          {
            upsert: async (args: {
              where: { workerType: string };
              create: Record<string, unknown>;
              update: Record<string, unknown>;
            }) => {
              heartbeats.push(args);
              return args.update;
            }
          }
        ]
      ],
      async () => {
        const result = await startCorpusAnalysis({
          corpusBookId: "book-disabled-resume",
          source: "manual-test",
          runFallbackWhenDisabled: true,
          maxJobs: 1,
          maxSeconds: 1
        });

        assert.equal(result.executionMode, "MANUAL");
        assert.equal(result.eventSent, false);
        assert.ok("batch" in result);
        assert.equal(result.batch.jobsRun, 0);
        assert.match(result.nextEligibleJobReason ?? "", /No queued/);
        assert.equal(
          heartbeats.some((heartbeat) => heartbeat.where.workerType === "MANUAL"),
          true
        );
        assert.equal(pipelineUpdates.length, 0);
      }
    );
  } finally {
    restoreEnv("ENABLE_INNGEST_WORKER", oldEnabled);
    restoreEnv("INNGEST_EVENT_KEY", oldEventKey);
    restoreEnv("INNGEST_SIGNING_KEY", oldSigningKey);
    restoreEnv("INNGEST_DEV", oldDev);
  }
});

test("status moves from not started to queued/running once jobs exist", () => {
  const plans = plannedCorpusPipelineJobs("book-4");
  const summary = summarizeCorpusAnalysis({
    book: {
      id: "book-4",
      fullTextAvailable: true,
      ingestionStatus: "IMPORTED",
      analysisStatus: "RUNNING",
      benchmarkReady: false,
      benchmarkBlockedReason: null,
      importProgress: {
        uploaded: true,
        textExtracted: true,
        cleaned: true
      }
    },
    jobs: plans.map((job, index) => ({
      id: `job-${index}`,
      type: job.type,
      status:
        index === 0
          ? PIPELINE_JOB_STATUS.COMPLETED
          : index === 1
            ? PIPELINE_JOB_STATUS.QUEUED
            : PIPELINE_JOB_STATUS.BLOCKED,
      error: null
    })),
    profileExists: false,
    chapterCount: 0,
    chunkCount: 0,
    embeddingStatuses: []
  });

  assert.equal(summary.analysisStatus, "RUNNING");
  assert.equal(summary.steps.imported.statusLabel, "Imported");
  assert.equal(summary.steps.cleaning.statusLabel, "Done");
  assert.equal(summary.steps.chapters.statusLabel, "Queued");
  assert.equal(summary.readyJobCount, 1);
  assert.equal(summary.unfinishedJobCount, 5);
});

test("after cleaning completes, corpus chapter detection becomes eligible", () => {
  const now = new Date("2026-04-29T10:05:00Z");
  const chaptersJob = {
    id: "chapters-job",
    type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS,
    status: PIPELINE_JOB_STATUS.BLOCKED,
    dependencyIds: ["clean-job"],
    updatedAt: now,
    readyAt: null,
    lockedAt: null,
    attempts: 0,
    maxAttempts: 3
  };

  assert.equal(canAttemptJob(chaptersJob, now), true);
  assert.equal(
    areDependenciesComplete(dependencyIdsFromJson(chaptersJob.dependencyIds), [
      { id: "clean-job", status: PIPELINE_JOB_STATUS.COMPLETED }
    ]),
    true
  );
  assert.equal(
    areDependenciesComplete(dependencyIdsFromJson(chaptersJob.dependencyIds), [
      { id: "clean-job", status: PIPELINE_JOB_STATUS.RUNNING }
    ]),
    false
  );
  const next = describeNextEligibleCorpusJob(
    [
      {
        id: "clean-job",
        type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN,
        status: PIPELINE_JOB_STATUS.COMPLETED,
        updatedAt: "2026-04-29T10:01:00Z"
      },
      chaptersJob
    ],
    now
  );

  assert.equal(next?.id, "chapters-job");
  assert.equal(next?.eligible, true);
  assert.equal(next?.dependencyStatus, "complete");
});

test("corpus pipeline dependencies advance cleaning to chapters to chunks", () => {
  const plans = plannedCorpusPipelineJobs("book-chain");

  assert.deepEqual(plans[1].dependencyKeys, [plans[0].idempotencyKey]);
  assert.deepEqual(plans[2].dependencyKeys, [plans[1].idempotencyKey]);
  assert.equal(
    areDependenciesComplete(["clean-job"], [
      { id: "clean-job", status: PIPELINE_JOB_STATUS.COMPLETED }
    ]),
    true
  );
  assert.equal(
    areDependenciesComplete(["chapters-job"], [
      { id: "chapters-job", status: PIPELINE_JOB_STATUS.QUEUED }
    ]),
    false
  );
  assert.equal(
    areDependenciesComplete(["chapters-job"], [
      { id: "chapters-job", status: PIPELINE_JOB_STATUS.COMPLETED }
    ]),
    true
  );
  const next = describeNextEligibleCorpusJob(
    [
      {
        id: "clean-job",
        type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN,
        status: PIPELINE_JOB_STATUS.COMPLETED,
        updatedAt: "2026-04-29T10:01:00Z"
      },
      {
        id: "chapters-job",
        type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS,
        status: PIPELINE_JOB_STATUS.COMPLETED,
        dependencyIds: ["clean-job"],
        updatedAt: "2026-04-29T10:02:00Z"
      },
      {
        id: "chunk-job",
        type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHUNK,
        status: PIPELINE_JOB_STATUS.QUEUED,
        dependencyIds: ["chapters-job"],
        updatedAt: "2026-04-29T10:03:00Z"
      }
    ],
    new Date("2026-04-29T10:04:00Z")
  );

  assert.equal(next?.id, "chunk-job");
  assert.equal(next?.eligible, true);
});

test("resume analysis diagnostics identify an existing queued corpus job", () => {
  const next = describeNextEligibleCorpusJob(
    [
      {
        id: "clean-job",
        type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN,
        status: PIPELINE_JOB_STATUS.COMPLETED,
        updatedAt: "2026-04-29T10:01:00Z"
      },
      {
        id: "chapters-job",
        type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS,
        status: PIPELINE_JOB_STATUS.QUEUED,
        dependencyIds: ["clean-job"],
        updatedAt: "2026-04-29T10:02:00Z"
      }
    ],
    new Date("2026-04-29T10:05:00Z")
  );

  assert.equal(next?.id, "chapters-job");
  assert.equal(next?.type, CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS);
  assert.equal(next?.eligible, true);
  assert.match(next?.reason ?? "", /Eligible/);
});

test("completed corpus jobs are not selected to rerun", () => {
  const next = describeNextEligibleCorpusJob(
    [
      {
        id: "clean-job",
        type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN,
        status: PIPELINE_JOB_STATUS.COMPLETED,
        updatedAt: "2026-04-29T10:01:00Z"
      },
      {
        id: "chapters-job",
        type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS,
        status: PIPELINE_JOB_STATUS.QUEUED,
        dependencyIds: ["clean-job"],
        updatedAt: "2026-04-29T10:02:00Z"
      }
    ],
    new Date("2026-04-29T10:05:00Z")
  );

  assert.equal(next?.id, "chapters-job");
});

test("getNextEligibleCorpusJob returns chapters for the live stuck corpus state", async () => {
  const jobs = liveStuckCorpusJobs("book-live");
  const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];

  await withPatchedPrisma(
    [
      [
        prisma.pipelineJob,
        {
          findMany: async (args: { where?: { id?: { in?: string[] } } }) => {
            const ids = args.where?.id?.in;
            return ids ? jobs.filter((job) => ids.includes(job.id)) : jobs;
          },
          update: async (args: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => {
            updates.push(args);
            const job = jobs.find((candidate) => candidate.id === args.where.id);
            assert.ok(job, `Expected job ${args.where.id} to exist`);
            Object.assign(job, args.data, { updatedAt: new Date() });
            return job;
          }
        }
      ]
    ],
    async () => {
      const next = await getNextEligibleCorpusJob("book-live");

      assert.equal(next?.id, "chapters-job");
      assert.equal(next?.type, CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS);
      assert.equal(next?.status, PIPELINE_JOB_STATUS.QUEUED);
      assert.equal(
        updates.some((update) => update.where.id === "clean-job"),
        false
      );
    }
  );
});

test("resume analysis does not touch clean and kicks chapters", async () => {
  const jobs = liveStuckCorpusJobs("book-resume");
  const runJobIds: string[] = [];
  const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];

  await withPatchedPrisma(
    [
      [
        prisma.pipelineJob,
        {
          findMany: async (args: { where?: { id?: { in?: string[] } } }) => {
            const ids = args.where?.id?.in;
            return ids ? jobs.filter((job) => ids.includes(job.id)) : jobs;
          },
          update: async (args: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => {
            updates.push(args);
            const job = jobs.find((candidate) => candidate.id === args.where.id);
            assert.ok(job, `Expected job ${args.where.id} to exist`);
            Object.assign(job, args.data, { updatedAt: new Date() });
            return job;
          }
        }
      ]
    ],
    async () => {
      const result = await runNextEligibleCorpusJob({
        corpusBookId: "book-resume",
        recordHeartbeat: false,
        releaseStaleLocks: false,
        runJob: async (jobId) => {
          runJobIds.push(jobId);
          const chapters = jobs.find((job) => job.id === "chapters-job");
          const chunk = jobs.find((job) => job.id === "chunk-job");
          assert.ok(chapters);
          assert.ok(chunk);
          chapters.status = PIPELINE_JOB_STATUS.COMPLETED;
          chunk.status = PIPELINE_JOB_STATUS.QUEUED;
          return {
            jobId,
            corpusBookId: "book-resume",
            type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS,
            status: "completed",
            readyJobIds: ["chunk-job"]
          };
        }
      });

      assert.deepEqual(runJobIds, ["chapters-job"]);
      assert.equal(
        result.nextEligibleJob?.type,
        CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS
      );
      assert.equal(result.results[0]?.status, "completed");
      assert.equal(
        updates.some((update) => update.where.id === "clean-job"),
        false
      );
    }
  );
});

test("completed jobs are never selected as next eligible corpus jobs", async () => {
  const completedJobs = [
    corpusPipelineJobForTest("book-done", CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN, {
      id: "clean-job",
      status: PIPELINE_JOB_STATUS.COMPLETED
    }),
    corpusPipelineJobForTest(
      "book-done",
      CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS,
      {
        id: "chapters-job",
        status: PIPELINE_JOB_STATUS.COMPLETED,
        dependencyIds: ["clean-job"]
      }
    )
  ];

  await withPatchedPrisma(
    [
      [
        prisma.pipelineJob,
        {
          findMany: async (args: { where?: { id?: { in?: string[] } } }) => {
            const ids = args.where?.id?.in;
            return ids
              ? completedJobs.filter((job) => ids.includes(job.id))
              : completedJobs;
          },
          update: async () => {
            throw new Error("Completed jobs should not be updated or selected.");
          }
        }
      ]
    ],
    async () => {
      const selection = await getNextEligibleCorpusJobSelection("book-done");

      assert.equal(selection.job, null);
      assert.match(selection.reason, /No eligible corpus job selected|No queued/);
    }
  );
});

test("ensuring corpus jobs does not touch completed clean when chapters is queued", async () => {
  const jobs = liveStuckCorpusJobs("book-ensure");
  const jobsByKey = new Map(jobs.map((job) => [job.idempotencyKey, job]));
  const pipelineUpdates: Array<{
    where: { id: string };
    data: Record<string, unknown>;
  }> = [];

  await withPatchedPrisma(
    [
      [
        prisma.corpusBook,
        {
          findUnique: async () => corpusBookForEnsure("book-ensure"),
          update: async (args: unknown) => args
        }
      ],
      [
        prisma.pipelineJob,
        {
          findFirst: async (args: {
            where?: { OR?: Array<{ idempotencyKey?: string }> };
          }) => {
            const key = args.where?.OR?.[0]?.idempotencyKey;
            return key ? jobsByKey.get(key) ?? null : null;
          },
          findMany: async (args: {
            where?: { id?: { in?: string[] }; status?: string };
          }) => {
            const ids = args.where?.id?.in;
            if (ids) {
              return jobs.filter((job) => ids.includes(job.id));
            }

            if (args.where?.status) {
              return jobs.filter((job) => job.status === args.where?.status);
            }

            return jobs;
          },
          update: async (args: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => {
            pipelineUpdates.push(args);
            const job = jobs.find((candidate) => candidate.id === args.where.id);
            assert.ok(job, `Expected job ${args.where.id} to exist`);
            Object.assign(job, args.data, { updatedAt: new Date() });
            return job;
          },
          create: async () => {
            throw new Error("All live stuck jobs should already exist.");
          }
        }
      ]
    ],
    async () => {
      await ensureCorpusAnalysisJobs("book-ensure");

      assert.equal(
        pipelineUpdates.some((update) => update.where.id === "clean-job"),
        false
      );
      assert.equal(jobs.find((job) => job.id === "chapters-job")?.status, "QUEUED");
    }
  );
});

test("blocked corpus jobs remain blocked until dependencies complete", () => {
  const next = describeNextEligibleCorpusJob(
    [
      {
        id: "chapters-job",
        type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS,
        status: PIPELINE_JOB_STATUS.QUEUED,
        updatedAt: "2026-04-29T10:02:00Z"
      },
      {
        id: "chunk-job",
        type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHUNK,
        status: PIPELINE_JOB_STATUS.BLOCKED,
        dependencyIds: ["chapters-job"],
        updatedAt: "2026-04-29T10:03:00Z"
      }
    ],
    new Date("2026-04-29T10:05:00Z")
  );

  assert.equal(next?.id, "chapters-job");
  assert.equal(next?.eligible, true);

  const blocked = describeNextEligibleCorpusJobSelection(
    [
      {
        id: "chunk-job",
        type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHUNK,
        status: PIPELINE_JOB_STATUS.BLOCKED,
        dependencyIds: ["chapters-job"],
        updatedAt: "2026-04-29T10:03:00Z"
      },
      {
        id: "chapters-job",
        type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS,
        status: PIPELINE_JOB_STATUS.RUNNING,
        updatedAt: "2026-04-29T10:02:00Z"
      }
    ],
    new Date("2026-04-29T10:05:00Z")
  );

  assert.equal(blocked.job, undefined);
  assert.match(blocked.reason, /Blocked until dependencies complete/);
});

test("legacy imported corpus books with no jobs still show the analysis action", () => {
  const summary = summarizeCorpusAnalysis({
    book: {
      id: "legacy-book",
      fullTextAvailable: true,
      ingestionStatus: "IMPORTED",
      analysisStatus: "NOT_STARTED",
      benchmarkReady: false,
      benchmarkBlockedReason: null,
      importProgress: {
        uploaded: true,
        textExtracted: true,
        cleaned: true
      }
    },
    jobs: [],
    profileExists: false,
    chapterCount: 0,
    chunkCount: 0,
    embeddingStatuses: []
  });

  assert.equal(summary.steps.imported.statusLabel, "Imported");
  assert.equal(summary.steps.bookDna.statusLabel, "Not started");
  assert.equal(
    shouldShowCorpusAnalysisAction({
      analysisStatus: "NOT_STARTED",
      summary
    }),
    true
  );
});

test("status endpoint response builder returns progress JSON shape", () => {
  const status = buildCorpusProgressStatus(
    progressInput({
      importProgress: {
        cleaned: true,
        chaptersDetected: true
      },
      jobs: [
        corpusJob("CORPUS_CLEAN", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:01:00Z"),
        corpusJob("CORPUS_CHAPTERS", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:02:00Z"),
        corpusJob("CORPUS_CHUNK", PIPELINE_JOB_STATUS.RUNNING, "2026-04-29T10:03:00Z")
      ],
      counts: {
        chapters: 12,
        chunks: 0,
        embeddedChunks: 0
      }
    })
  );

  assert.equal(status.bookId, "book-progress");
  assert.equal(status.counts.chapters, 12);
  assert.equal(status.counts.totalJobs, 3);
  assert.equal(status.counts.runningJobs, 1);
  assert.deepEqual(
    status.steps.map((step) => step.key),
    [
      "imported",
      "cleaning",
      "chapters",
      "chunks",
      "embeddings",
      "book_dna",
      "benchmark_ready"
    ]
  );
  assert.equal(status.progress.currentStepLabel, "Chunks");
});

test("status endpoint exposes next eligible corpus job diagnostics", () => {
  const status = buildCorpusProgressStatus(
    progressInput({
      jobs: [
        {
          id: "clean-job",
          type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN,
          status: PIPELINE_JOB_STATUS.COMPLETED,
          updatedAt: "2026-04-29T10:01:00Z",
          error: null
        },
        {
          id: "chapters-job",
          type: CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS,
          status: PIPELINE_JOB_STATUS.QUEUED,
          dependencyIds: ["clean-job"],
          readyAt: null,
          lockedAt: null,
          attempts: 0,
          maxAttempts: 3,
          updatedAt: "2026-04-29T10:02:00Z",
          error: null
        }
      ]
    })
  );

  assert.equal(status.nextEligibleJob?.id, "chapters-job");
  assert.equal(status.nextEligibleJob?.type, CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS);
  assert.equal(status.nextEligibleJob?.status, PIPELINE_JOB_STATUS.QUEUED);
  assert.equal(status.nextEligibleJob?.dependencyStatus, "complete");
  assert.equal(status.nextEligibleJob?.eligible, true);
});

test("corpus progress percent is calculated from completed stages", () => {
  const status = buildCorpusProgressStatus(
    progressInput({
      benchmarkBlockedReason: "Benchmark use is not allowed.",
      importProgress: {
        cleaned: true,
        chaptersDetected: true,
        chunksCreated: true,
        embeddingsCreated: true,
        embeddingStatus: "skipped: OPENAI_API_KEY not configured",
        bookDnaExtracted: true
      },
      profileExists: true,
      counts: {
        chapters: 12,
        chunks: 24,
        embeddedChunks: 0
      },
      embeddingStatusCounts: [{ status: "SKIPPED", count: 24 }],
      jobs: [
        corpusJob("CORPUS_CLEAN", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:01:00Z"),
        corpusJob("CORPUS_CHAPTERS", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:02:00Z"),
        corpusJob("CORPUS_CHUNK", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:03:00Z"),
        corpusJob("CORPUS_EMBED", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:04:00Z"),
        corpusJob("CORPUS_PROFILE", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:05:00Z"),
        corpusJob("CORPUS_BENCHMARK_CHECK", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:06:00Z")
      ]
    })
  );

  assert.equal(status.steps.find((step) => step.key === "embeddings")?.status, "skipped");
  assert.equal(status.steps.find((step) => step.key === "benchmark_ready")?.status, "blocked");
  assert.equal(status.progress.percent, 100);
  assert.equal(status.progress.isBlocked, true);
  assert.equal(status.progress.isComplete, true);
});

test("polling is active only while corpus work is queued or running", () => {
  const running = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "RUNNING",
      jobs: [
        corpusJob("CORPUS_CLEAN", PIPELINE_JOB_STATUS.RUNNING, "2026-04-29T10:01:00Z")
      ]
    })
  );
  const noActiveJobs = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "RUNNING",
      jobs: [
        corpusJob("CORPUS_CLEAN", PIPELINE_JOB_STATUS.COMPLETED, "2026-04-29T10:01:00Z")
      ]
    })
  );

  assert.equal(shouldPollCorpusStatus(running), true);
  assert.equal(shouldPollCorpusStatus(noActiveJobs), false);
});

test("polling stops when corpus analysis is complete", () => {
  const complete = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "COMPLETED",
      benchmarkReady: true,
      importProgress: {
        cleaned: true,
        chaptersDetected: true,
        chunksCreated: true,
        embeddingsCreated: true,
        bookDnaExtracted: true
      },
      profileExists: true,
      counts: {
        chapters: 12,
        chunks: 24,
        embeddedChunks: 24
      },
      embeddingStatusCounts: [{ status: "STORED", count: 24 }]
    })
  );

  assert.equal(complete.progress.isComplete, true);
  assert.equal(shouldPollCorpusStatus(complete), false);
});

test("failed job appears in corpus status response", () => {
  const status = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "FAILED",
      jobs: [
        corpusJob(
          "CORPUS_EMBED",
          PIPELINE_JOB_STATUS.FAILED,
          "2026-04-29T10:04:00Z",
          "Embedding provider rejected the request."
        )
      ]
    })
  );

  assert.equal(status.counts.failedJobs, 1);
  assert.equal(status.latestJob?.status, PIPELINE_JOB_STATUS.FAILED);
  assert.equal(status.latestJob?.error, "Embedding provider rejected the request.");
  assert.equal(status.steps.find((step) => step.key === "embeddings")?.status, "failed");
  assert.equal(status.progress.isFailed, true);
});

test("stale job warning appears when latest job update is old", () => {
  const now = new Date("2026-04-29T10:05:00Z");
  const status = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "RUNNING",
      jobs: [
        corpusJob("CORPUS_CHUNK", PIPELINE_JOB_STATUS.RUNNING, "2026-04-29T10:00:00Z")
      ]
    })
  );

  assert.equal(
    staleWarningText(status, now),
    "Analysis may be stuck. Last job update was 5 minutes ago."
  );
});

test("corpus retry and resume button state is derived from progress", () => {
  const now = new Date("2026-04-29T10:05:00Z");
  const failed = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "FAILED",
      jobs: [
        corpusJob("CORPUS_EMBED", PIPELINE_JOB_STATUS.FAILED, "2026-04-29T10:02:00Z")
      ]
    })
  );
  const stale = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "RUNNING",
      jobs: [
        corpusJob("CORPUS_CHUNK", PIPELINE_JOB_STATUS.RUNNING, "2026-04-29T10:00:00Z")
      ]
    })
  );
  const completeReady = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "COMPLETED",
      benchmarkReady: true,
      profileExists: true,
      importProgress: {
        cleaned: true,
        chaptersDetected: true,
        chunksCreated: true,
        embeddingsCreated: true,
        bookDnaExtracted: true
      },
      counts: {
        chapters: 12,
        chunks: 24,
        embeddedChunks: 24
      },
      embeddingStatusCounts: [{ status: "STORED", count: 24 }]
    })
  );
  const completeNotReady = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "COMPLETED",
      profileExists: true,
      importProgress: {
        cleaned: true,
        chaptersDetected: true,
        chunksCreated: true,
        embeddingsCreated: true,
        bookDnaExtracted: true
      }
    })
  );
  const notStarted = buildCorpusProgressStatus(
    progressInput({
      analysisStatus: "NOT_STARTED",
      ingestionStatus: "IMPORTED"
    })
  );

  assert.equal(getCorpusProgressAction(failed, now).kind, "retry_failed");
  assert.equal(getCorpusProgressAction(stale, now).kind, "resume");
  assert.equal(getCorpusProgressAction(completeReady, now).kind, "view_book_dna");
  assert.equal(
    getCorpusProgressAction(completeNotReady, now).kind,
    "check_benchmark"
  );
  assert.equal(getCorpusProgressAction(notStarted, now).kind, "start");
});

function liveStuckCorpusJobs(corpusBookId: string) {
  const clean = corpusPipelineJobForTest(
    corpusBookId,
    CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN,
    {
      id: "clean-job",
      status: PIPELINE_JOB_STATUS.COMPLETED,
      completedAt: new Date("2026-04-29T10:01:00Z"),
      updatedAt: new Date("2026-04-29T10:01:00Z")
    }
  );
  const chapters = corpusPipelineJobForTest(
    corpusBookId,
    CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS,
    {
      id: "chapters-job",
      status: PIPELINE_JOB_STATUS.QUEUED,
      dependencyIds: [clean.id],
      updatedAt: new Date("2026-04-29T10:02:00Z")
    }
  );
  const chunk = corpusPipelineJobForTest(
    corpusBookId,
    CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHUNK,
    {
      id: "chunk-job",
      status: PIPELINE_JOB_STATUS.BLOCKED,
      dependencyIds: [chapters.id],
      updatedAt: new Date("2026-04-29T10:03:00Z")
    }
  );
  const embed = corpusPipelineJobForTest(
    corpusBookId,
    CORPUS_PIPELINE_JOB_TYPES.CORPUS_EMBED,
    {
      id: "embed-job",
      status: PIPELINE_JOB_STATUS.BLOCKED,
      dependencyIds: [chunk.id],
      updatedAt: new Date("2026-04-29T10:04:00Z")
    }
  );
  const profile = corpusPipelineJobForTest(
    corpusBookId,
    CORPUS_PIPELINE_JOB_TYPES.CORPUS_PROFILE,
    {
      id: "profile-job",
      status: PIPELINE_JOB_STATUS.BLOCKED,
      dependencyIds: [embed.id],
      updatedAt: new Date("2026-04-29T10:05:00Z")
    }
  );
  const benchmark = corpusPipelineJobForTest(
    corpusBookId,
    CORPUS_PIPELINE_JOB_TYPES.CORPUS_BENCHMARK_CHECK,
    {
      id: "benchmark-job",
      status: PIPELINE_JOB_STATUS.BLOCKED,
      dependencyIds: [profile.id],
      updatedAt: new Date("2026-04-29T10:06:00Z")
    }
  );

  return [clean, chapters, chunk, embed, profile, benchmark];
}

function completedCorpusJobs(corpusBookId: string) {
  const plans = plannedCorpusPipelineJobs(corpusBookId);
  const jobIds = plans.map((plan) => `${plan.type.toLowerCase()}-completed-job`);

  const jobs = plans.map((plan, index) =>
    corpusPipelineJobForTest(corpusBookId, plan.type, {
      id: jobIds[index],
      status: PIPELINE_JOB_STATUS.COMPLETED,
      dependencyIds: index === 0 ? [] : [jobIds[index - 1]],
      completedAt: new Date(`2026-04-29T10:0${index + 1}:30Z`)
    })
  );

  return jobs;
}

function corpusPipelineJobForTest(
  corpusBookId: string,
  type: string,
  overrides: Partial<PipelineJob> = {}
): PipelineJob {
  const order = corpusJobOrderForTest(type);
  const createdAt = new Date(`2026-04-29T10:0${order}:00Z`);

  return {
    id: `${type.toLowerCase()}-job`,
    manuscriptId: null,
    snapshotId: null,
    chapterId: null,
    type,
    status: PIPELINE_JOB_STATUS.QUEUED,
    idempotencyKey: corpusPipelineJobKey(
      corpusBookId,
      type as CorpusPipelineJobType
    ),
    dependencyIds: [],
    readyAt: null,
    lockedAt: null,
    lockedBy: null,
    lockExpiresAt: null,
    attempts: 0,
    maxAttempts: type === CORPUS_PIPELINE_JOB_TYPES.CORPUS_EMBED ? 2 : 3,
    error: null,
    metadata: {
      corpusBookId,
      step: type,
      order,
      pipeline: "CORPUS_ANALYSIS"
    },
    result: null,
    startedAt: null,
    completedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides
  };
}

function filterCorpusJobsForTest(
  jobs: PipelineJob[],
  where?: { id?: { in?: string[] }; status?: string | { in?: string[] } }
) {
  const ids = where?.id?.in;
  if (ids) {
    return jobs.filter((job) => ids.includes(job.id));
  }

  const status = where?.status;
  if (typeof status === "string") {
    return jobs.filter((job) => job.status === status);
  }

  if (status?.in) {
    return jobs.filter((job) => status.in?.includes(job.status));
  }

  return jobs;
}

function corpusJobOrderForTest(type: string) {
  return [
    CORPUS_PIPELINE_JOB_TYPES.CORPUS_CLEAN,
    CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHAPTERS,
    CORPUS_PIPELINE_JOB_TYPES.CORPUS_CHUNK,
    CORPUS_PIPELINE_JOB_TYPES.CORPUS_EMBED,
    CORPUS_PIPELINE_JOB_TYPES.CORPUS_PROFILE,
    CORPUS_PIPELINE_JOB_TYPES.CORPUS_BENCHMARK_CHECK
  ].indexOf(type as CorpusPipelineJobType) + 1;
}

function corpusBookForEnsure(corpusBookId: string) {
  return {
    id: corpusBookId,
    fullTextAvailable: true,
    ingestionStatus: "IMPORTED",
    analysisStatus: "RUNNING",
    benchmarkReady: false,
    benchmarkReadyAt: null,
    benchmarkBlockedReason: null,
    importProgress: {
      uploaded: true,
      textExtracted: true,
      cleaned: true
    },
    text: {
      cleanedText: "Cleaned corpus text.",
      cleanedAt: new Date("2026-04-29T10:01:00Z")
    },
    profile: null,
    chunks: [],
    importJobs: [],
    _count: {
      chapters: 0,
      chunks: 0
    }
  };
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

function progressInput(
  overrides: Partial<
    Omit<CorpusProgressBuildInput, "book"> & {
      analysisStatus: string;
      benchmarkBlockedReason: string | null;
      benchmarkReady: boolean;
      fullTextAvailable: boolean;
      ingestionStatus: string;
      importProgress: Record<string, unknown>;
      profileExists: boolean;
    }
  > = {}
): CorpusProgressBuildInput {
  return {
    book: {
      id: "book-progress",
      fullTextAvailable: overrides.fullTextAvailable ?? true,
      ingestionStatus: overrides.ingestionStatus ?? "IMPORTED",
      analysisStatus: overrides.analysisStatus ?? "RUNNING",
      benchmarkReady: overrides.benchmarkReady ?? false,
      benchmarkBlockedReason: overrides.benchmarkBlockedReason,
      updatedAt: "2026-04-29T10:00:00Z",
      importProgress: {
        uploaded: true,
        textExtracted: true,
        ...(overrides.importProgress ?? {})
      },
      textCleanedAt: "2026-04-29T10:01:00Z",
      latestImportStep: "uploaded",
      latestImportUpdatedAt: "2026-04-29T10:01:00Z",
      profileCreatedAt: overrides.profileExists ? "2026-04-29T10:05:00Z" : null,
      profileExists: overrides.profileExists ?? false
    },
    counts: overrides.counts ?? {
      chapters: 0,
      chunks: 0,
      embeddedChunks: 0
    },
    embeddingStatusCounts: overrides.embeddingStatusCounts ?? [],
    jobs: overrides.jobs ?? []
  };
}

function corpusJob(
  type: string,
  status: string,
  updatedAt: string,
  error: string | null = null
) {
  return {
    id: `${type}-${status}`,
    type,
    status,
    updatedAt,
    error
  };
}
