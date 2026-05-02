import test from "node:test";
import assert from "node:assert/strict";
import {
  AnalysisPassType,
  AnalysisRunStatus,
  AnalysisRunType,
  AnalysisStatus
} from "@prisma/client";
import {
  buildBoundedCorpusComparisonInput,
  DEFAULT_CORPUS_COMPARISON_LIMITS,
  serializeCorpusComparisonInput,
  type CorpusComparisonInput
} from "../lib/ai/corpusComparator";
import {
  runPipelineStep,
  setCorpusComparisonRunnerForTest
} from "../lib/pipeline/manuscriptPipeline";
import { PIPELINE_JOB_STATUS } from "../lib/pipeline/jobRules";
import { runPipelineJob } from "../lib/pipeline/pipelineJobs";
import { normalizeCheckpoint } from "../lib/pipeline/steps";
import { prisma } from "../lib/prisma";

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

type MutableJob = {
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

test("bounded corpus comparison trims profiles, references, and chunk excerpts before model input", () => {
  const lateMarker = "RAW_CORPUS_TEXT_AFTER_LIMIT_SHOULD_NOT_APPEAR";
  const fullProfileMarker = "FULL_PROFILE_TEXT_SHOULD_NOT_APPEAR";
  const input: CorpusComparisonInput = {
    manuscriptTitle: "A Long Test Manuscript",
    targetGenre: "Fantasy",
    manuscriptLanguage: "en",
    manuscriptProfile: {
      wordCount: 100000,
      openingHookType: "slow burn",
      rawText: fullProfileMarker
    },
    wholeBookAudit: {
      executiveSummary: "Whole book summary.",
      topIssues: Array.from({ length: 4 }, (_, index) => ({
        severity: 4,
        problem: `Problem ${index}`,
        evidence: "Evidence ".repeat(80),
        recommendation: "Recommendation ".repeat(80)
      })),
      valueRaisingEdits: ["Move conflict earlier.", "Tighten scene goals."]
    },
    rightsStatusCounts: { PUBLIC_DOMAIN: 12 },
    benchmarkProfiles: Array.from({ length: 6 }, (_, index) => ({
      bookId: `book-${index}`,
      title: `Benchmark ${index}`,
      author: "Public Author",
      rightsStatus: "PUBLIC_DOMAIN",
      genre: "Fantasy",
      language: "en",
      profile: {
        openingHookType: "conflict ".repeat(80) + fullProfileMarker,
        pacingCurve: Array.from({ length: 10 }, () => ({
          note: "pacing ".repeat(80) + fullProfileMarker
        })),
        rawText: fullProfileMarker
      }
    })),
    sameLanguageProfiles: [],
    sameGenreProfiles: [],
    selectedProfiles: [],
    chunkSimilarityBasis: "profile-filtered chunks",
    similarChunks: Array.from({ length: 5 }, (_, index) => ({
      bookTitle: `Chunk Book ${index}`,
      author: "Open Author",
      rightsStatus: "PUBLIC_DOMAIN",
      summary: "summary ".repeat(80) + lateMarker,
      excerpt: "excerpt ".repeat(80) + lateMarker,
      metrics: {
        scene: "metrics ".repeat(80) + lateMarker
      }
    }))
  };

  const bounded = buildBoundedCorpusComparisonInput(input, {
    maxBenchmarkProfiles: 2,
    maxProfileReferences: 1,
    maxCorpusChunks: 2,
    maxChunkSummaryCharacters: 80,
    maxCorpusChunkExcerptCharacters: 70,
    maxTotalCorpusExcerptCharacters: 100,
    maxWholeBookNotes: 1,
    maxProfileArrayItems: 2,
    maxProfileStringCharacters: 60,
    maxSerializedInputCharacters: 100000
  });
  const serialized = serializeCorpusComparisonInput(bounded.input);

  assert.equal(bounded.includedProfileCount, 2);
  assert.equal(bounded.includedChunkCount, 2);
  assert.equal(bounded.includedWholeBookNoteCount, 1);
  assert.equal(bounded.input.benchmarkProfiles.length, 2);
  assert.equal(bounded.input.similarChunks.length, 2);
  assert.equal((bounded.input.similarChunks[0].excerpt ?? "").length <= 70, true);
  assert.equal((bounded.input.similarChunks[1].excerpt ?? "").length <= 30, true);
  assert.equal(serialized.includes(lateMarker), false);
  assert.equal(serialized.includes(fullProfileMarker), false);
  assert.equal(serialized.includes("rawText"), false);
});

test("oversized corpus context skips without invoking the model runner", async () => {
  let modelCalls = 0;
  const restoreRunner = setCorpusComparisonRunnerForTest(async () => {
    modelCalls += 1;
    throw new Error("Model runner should not be called for oversized context.");
  });
  const outputs = wholeBookOutputFixture("run-oversized", "manuscript-oversized");

  try {
    await withPatchedPrisma(
      corpusStepPatches({
        manuscriptId: "manuscript-oversized",
        outputs,
        profiles: Array.from({ length: 12 }, (_, index) =>
          bookProfileFixture(index, heavyProfileFields())
        ),
        chunks: []
      }),
      async () => {
        const result = await runPipelineStep(
          "compareAgainstCorpus",
          "manuscript-oversized",
          "run-oversized"
        ) as Record<string, unknown>;

        assert.equal(modelCalls, 0);
        assert.equal(result.complete, true);
        assert.equal(result.reason, "corpus_context_too_large");

        const saved = corpusOutput(outputs);
        assert.equal(savedOutput(saved).reason, "corpus_context_too_large");
        assert.equal(savedOutput(saved).metadata.reason, undefined);
        assert.equal(typeof savedOutput(saved).metadata.estimatedInputCharacters, "number");
        assert.equal(savedOutput(saved).metadata.includedProfileCount, 10);
        assert.equal(savedInputSummary(saved).skipReason, "corpus_context_too_large");
        assert.equal(
          savedInputSummary(saved).maxBudget,
          DEFAULT_CORPUS_COMPARISON_LIMITS.maxSerializedInputCharacters
        );
      }
    );
  } finally {
    restoreRunner();
  }
});

test("request-too-large model errors save skipped output and complete the corpus job", async () => {
  const manuscriptId = "manuscript-request-too-large";
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
      "runWholeBookAudit"
    ],
    currentStep: "compareAgainstCorpus"
  });
  const corpusJob = mutableJob("corpus-job", {
    manuscriptId,
    type: "compareAgainstCorpus",
    status: PIPELINE_JOB_STATUS.QUEUED,
    idempotencyKey: "pipeline:manuscript-request-too-large:compareAgainstCorpus"
  });
  const trendJob = mutableJob("trend-job", {
    manuscriptId,
    type: "compareAgainstTrendSignals",
    status: PIPELINE_JOB_STATUS.BLOCKED,
    idempotencyKey: "pipeline:manuscript-request-too-large:compareAgainstTrendSignals",
    dependencyIds: [corpusJob.id]
  });
  const jobs = [corpusJob, trendJob];
  const outputs = wholeBookOutputFixture(run.id, manuscriptId);
  const modelInputs: CorpusComparisonInput[] = [];
  const modelOptions: Array<{ retries?: number }> = [];
  const restoreRunner = setCorpusComparisonRunnerForTest(async (input, options) => {
    modelInputs.push(input);
    modelOptions.push(options ?? {});
    throw new Error(
      "429 Request too large for gpt-5.4-mini. Limit 200000 TPM. Requested 273212."
    );
  });

  try {
    await withPatchedPrisma(
      [
        ...corpusStepPatches({
          manuscriptId,
          outputs,
          profiles: [bookProfileFixture(1, smallProfileFields())],
          chunks: [
            corpusChunkFixture(
              1,
              "A short allowed excerpt. ".repeat(80) +
                "RAW_CORPUS_TEXT_AFTER_LIMIT_SHOULD_NOT_APPEAR"
            )
          ],
          manuscriptPatch: {
            update: async (args: { data: Record<string, unknown> }) => ({
              id: manuscriptId,
              ...args.data
            })
          }
        }),
        [prisma.analysisRun, analysisRunPatch(run)],
        [prisma.pipelineJob, pipelineJobPatch(jobs)]
      ],
      async () => {
        const result = await runPipelineJob(corpusJob.id, {
          workerId: "test:corpus-request-too-large"
        });

        assert.equal(result.status, "completed");
        assert.equal(corpusJob.status, PIPELINE_JOB_STATUS.COMPLETED);
        assert.equal(trendJob.status, PIPELINE_JOB_STATUS.QUEUED);
        assert.deepEqual(result.readyJobIds, [trendJob.id]);
        assert.equal(modelInputs.length, 1);
        assert.equal(modelOptions[0].retries, 0);
        assert.equal(modelInputs[0].benchmarkProfiles.length, 1);
        assert.equal(
          (modelInputs[0].similarChunks[0].excerpt ?? "").includes(
            "RAW_CORPUS_TEXT_AFTER_LIMIT_SHOULD_NOT_APPEAR"
          ),
          false
        );
        assert.equal(
          (modelInputs[0].similarChunks[0].excerpt ?? "").length <=
            DEFAULT_CORPUS_COMPARISON_LIMITS.maxCorpusChunkExcerptCharacters,
          true
        );
        assert.equal(
          "profile" in (modelInputs[0].sameGenreProfiles?.[0] as Record<string, unknown>),
          false
        );

        const saved = corpusOutput(outputs);
        assert.equal(savedOutput(saved).reason, "corpus_request_too_large");
        assert.match(
          String(savedOutput(saved).metadata.errorMessage),
          /Requested 273212/
        );
        assert.equal(typeof savedOutput(saved).metadata.estimatedInputCharacters, "number");
        assert.equal(savedInputSummary(saved).skipReason, "corpus_request_too_large");
        assert.equal(savedInputSummary(saved).includedProfileCount, 1);
        assert.equal(savedInputSummary(saved).includedChunkCount, 1);
        assert.deepEqual(corpusJob.result, {
          skipped: true,
          reason: "corpus_request_too_large",
          complete: true
        });

        const checkpoint = normalizeCheckpoint(run.checkpoint);
        assert.equal(
          checkpoint.completedSteps?.includes("compareAgainstCorpus"),
          true
        );
      }
    );
  } finally {
    restoreRunner();
  }
});

function corpusStepPatches(input: {
  manuscriptId: string;
  outputs: Array<Record<string, unknown>>;
  profiles: Array<Record<string, unknown>>;
  chunks: Array<Record<string, unknown>>;
  manuscriptPatch?: Record<string, unknown>;
}): Array<[object, Record<string, unknown>]> {
  return [
    [
      prisma.manuscript,
      {
        findUniqueOrThrow: async () => manuscriptFixture(input.manuscriptId),
        update: async (args: { data: Record<string, unknown> }) => ({
          id: input.manuscriptId,
          ...args.data
        }),
        ...(input.manuscriptPatch ?? {})
      }
    ],
    [prisma.bookProfile, { findMany: async () => input.profiles }],
    [prisma.corpusChunk, { findMany: async () => input.chunks }],
    [prisma.manuscriptChunk, { count: async () => 1 }],
    [prisma.analysisOutput, analysisOutputPatch(input.outputs)],
    [
      prisma.finding,
      {
        deleteMany: async () => ({ count: 0 }),
        createMany: async (args: { data: unknown[] }) => ({ count: args.data.length })
      }
    ]
  ];
}

function manuscriptFixture(manuscriptId: string) {
  return {
    id: manuscriptId,
    title: "Safety Manuscript",
    targetGenre: "Fantasy",
    targetAudience: "Adult",
    metadata: {
      language: "en",
      selectedCorpusBookIds: ["book-1"]
    },
    profile: {
      id: "manuscript-profile",
      manuscriptId,
      wordCount: 90000,
      chapterCount: 24,
      openingHookType: "atmospheric",
      pacingCurve: [{ chapterIndex: 1, actionRatio: 0.1 }]
    }
  };
}

function bookProfileFixture(index: number, fields: Record<string, unknown>) {
  return {
    id: `profile-${index}`,
    bookId: `book-${index}`,
    createdAt: new Date("2026-05-01T08:00:00Z"),
    ...fields,
    book: {
      id: `book-${index}`,
      title: `Benchmark ${index}`,
      author: "Public Author",
      rightsStatus: "PUBLIC_DOMAIN",
      allowedUses: { corpusBenchmarking: true },
      benchmarkReady: true,
      genre: "Fantasy",
      language: "en"
    }
  };
}

function corpusChunkFixture(index: number, text: string) {
  return {
    id: `chunk-${index}`,
    bookId: `book-${index}`,
    chunkIndex: index,
    text,
    summary: "A rights-safe summary. ".repeat(20),
    metrics: {
      actionRatio: 0.2,
      expositionRatio: 0.3,
      note: "compact metric"
    },
    embeddingStatus: "STORED",
    createdAt: new Date("2026-05-01T08:00:00Z"),
    book: {
      id: `book-${index}`,
      title: `Open Chunk Book ${index}`,
      author: "Open Author",
      rightsStatus: "PUBLIC_DOMAIN",
      allowedUses: { corpusBenchmarking: true },
      benchmarkReady: true,
      genre: "Fantasy",
      language: "en"
    }
  };
}

function smallProfileFields() {
  return {
    wordCount: 70000,
    chapterCount: 20,
    avgChapterWords: 3500,
    dialogueRatio: 0.2,
    expositionRatio: 0.3,
    actionRatio: 0.2,
    openingHookType: "early-conflict",
    pacingCurve: [{ chapterIndex: 1, actionRatio: 0.2 }],
    literaryCraftLessons: ["Move conflict into the opening promise."]
  };
}

function heavyProfileFields() {
  const huge = "large-profile-field ".repeat(1400);
  return {
    wordCount: 70000,
    chapterCount: 20,
    avgChapterWords: [huge, huge, huge, huge, huge, huge, huge, huge],
    medianChapterWords: [huge, huge, huge, huge, huge, huge, huge, huge],
    minChapterWords: [huge, huge, huge, huge, huge, huge, huge, huge],
    maxChapterWords: [huge, huge, huge, huge, huge, huge, huge, huge],
    avgSentenceLength: [huge, huge, huge, huge, huge, huge, huge, huge],
    dialogueRatio: [huge, huge, huge, huge, huge, huge, huge, huge],
    questionRatio: [huge, huge, huge, huge, huge, huge, huge, huge],
    exclamationRatio: [huge, huge, huge, huge, huge, huge, huge, huge],
    expositionRatio: [huge, huge, huge, huge, huge, huge, huge, huge],
    actionRatio: [huge, huge, huge, huge, huge, huge, huge, huge],
    introspectionRatio: [huge, huge, huge, huge, huge, huge, huge, huge],
    lexicalDensity: [huge, huge, huge, huge, huge, huge, huge, huge],
    paragraphLengthDistribution: [huge, huge, huge, huge, huge, huge, huge, huge],
    sentenceLengthDistribution: [huge, huge, huge, huge, huge, huge, huge, huge],
    repeatedTerms: [huge, huge, huge, huge, huge, huge, huge, huge],
    chapterLengthCurve: [huge, huge, huge, huge, huge, huge, huge, huge],
    povEstimate: huge,
    tenseEstimate: huge,
    openingHookType: huge,
    pacingCurve: [huge, huge, huge, huge, huge, huge, huge, huge],
    emotionalIntensityCurve: [huge, huge, huge, huge, huge, huge, huge, huge],
    conflictDensityCurve: [huge, huge, huge, huge, huge, huge, huge, huge],
    chapterEndingPatterns: [huge, huge, huge, huge, huge, huge, huge, huge],
    dominantSceneModes: [huge, huge, huge, huge, huge, huge, huge, huge],
    narrativeDistance: huge,
    styleFingerprint: [huge, huge, huge, huge, huge, huge, huge, huge],
    dialogueStyle: [huge, huge, huge, huge, huge, huge, huge, huge],
    expositionStyle: [huge, huge, huge, huge, huge, huge, huge, huge],
    genreMarkers: [huge, huge, huge, huge, huge, huge, huge, huge],
    tropeMarkers: [huge, huge, huge, huge, huge, huge, huge, huge],
    literaryCraftLessons: [huge, huge, huge, huge, huge, huge, huge, huge],
    deterministicMetrics: [huge, huge, huge, huge, huge, huge, huge, huge],
    aiMetrics: [huge, huge, huge, huge, huge, huge, huge, huge]
  };
}

function wholeBookOutputFixture(runId: string, manuscriptId: string) {
  return [
    {
      id: "whole-book-output",
      runId,
      manuscriptId,
      passType: AnalysisPassType.WHOLE_BOOK_AUDIT,
      scopeType: "manuscript",
      scopeId: manuscriptId,
      output: {
        executiveSummary: "Whole book audit completed.",
        topIssues: [
          {
            severity: 4,
            problem: "Opening promise arrives late.",
            evidence: "Chapter summaries show delayed conflict.",
            recommendation: "Move conflict earlier."
          }
        ],
        valueRaisingEdits: ["Move conflict earlier."]
      },
      inputSummary: {},
      rawText: "{}"
    }
  ];
}

function analysisOutputPatch(outputs: Array<Record<string, unknown>>) {
  return {
    findUnique: async (args: {
      where: { runId_passType_scopeType_scopeId: OutputKey };
    }) => findOutput(outputs, args.where.runId_passType_scopeType_scopeId),
    upsert: async (args: {
      where: { runId_passType_scopeType_scopeId: OutputKey };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const existing = findOutput(outputs, args.where.runId_passType_scopeType_scopeId);
      if (existing) {
        Object.assign(existing, args.update);
        return existing;
      }

      const output = { id: `output-${outputs.length + 1}`, ...args.create };
      outputs.push(output);
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

function findOutput(outputs: Array<Record<string, unknown>>, key: OutputKey) {
  return (
    outputs.find(
      (output) =>
        output.runId === key.runId &&
        output.passType === key.passType &&
        output.scopeType === key.scopeType &&
        output.scopeId === key.scopeId
    ) ?? null
  );
}

function corpusOutput(outputs: Array<Record<string, unknown>>) {
  const output = outputs.find(
    (candidate) => candidate.passType === AnalysisPassType.CORPUS_COMPARISON
  );
  assert.ok(output);
  return output;
}

function savedOutput(output: Record<string, unknown>) {
  return output.output as {
    reason: string;
    metadata: Record<string, unknown>;
  };
}

function savedInputSummary(output: Record<string, unknown>) {
  return output.inputSummary as Record<string, unknown>;
}

function mutableRun(manuscriptId: string, checkpoint: unknown): MutableRun {
  const now = new Date("2026-05-01T08:00:00Z");
  return {
    id: `${manuscriptId}-run`,
    manuscriptId,
    type: AnalysisRunType.FULL_AUDIT,
    status: AnalysisRunStatus.RUNNING,
    model: "test-model",
    currentPass: AnalysisPassType.CORPUS_COMPARISON,
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
    }
  };
}

function mutableJob(id: string, data: Partial<MutableJob>): MutableJob {
  const now = new Date("2026-05-01T08:00:00Z");
  return {
    id,
    manuscriptId: data.manuscriptId ?? null,
    chapterId: data.chapterId ?? null,
    type: String(data.type),
    status: data.status ?? PIPELINE_JOB_STATUS.QUEUED,
    idempotencyKey: data.idempotencyKey ?? id,
    dependencyIds: data.dependencyIds ?? [],
    readyAt: data.readyAt ?? null,
    lockedAt: data.lockedAt ?? null,
    lockedBy: data.lockedBy ?? null,
    lockExpiresAt: data.lockExpiresAt ?? null,
    attempts: data.attempts ?? 0,
    maxAttempts: data.maxAttempts ?? 3,
    error: data.error ?? null,
    metadata: data.metadata ?? null,
    result: data.result ?? null,
    startedAt: data.startedAt ?? null,
    completedAt: data.completedAt ?? null,
    createdAt: now,
    updatedAt: now
  };
}

function pipelineJobPatch(jobs: MutableJob[]) {
  return {
    findUnique: async (args: { where: { id?: string; idempotencyKey?: string } }) =>
      jobs.find((job) =>
        args.where.id ? job.id === args.where.id : job.idempotencyKey === args.where.idempotencyKey
      ) ?? null,
    findMany: async (args: { where?: Record<string, unknown> } = {}) =>
      jobs.filter((job) => matchesWhere(job, args.where)),
    count: async (args: { where?: Record<string, unknown> } = {}) =>
      jobs.filter((job) => matchesWhere(job, args.where)).length,
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const job = jobs.find((candidate) => candidate.id === args.where.id);
      assert.ok(job);
      applyJobData(job, args.data);
      return job;
    },
    updateMany: async (args: { where?: Record<string, unknown>; data: Record<string, unknown> }) => {
      const targets = jobs.filter((job) => matchesWhere(job, args.where));
      for (const job of targets) {
        applyJobData(job, args.data);
      }
      return { count: targets.length };
    }
  };
}

function matchesWhere(item: Record<string, unknown>, where: Record<string, unknown> = {}) {
  if (!where) return true;

  const and = Array.isArray(where.AND) ? where.AND : [];
  if (and.length > 0 && !and.every((part) => matchesWhere(item, recordValue(part) ?? {}))) {
    return false;
  }

  const or = Array.isArray(where.OR) ? where.OR : [];
  if (or.length > 0 && !or.some((part) => matchesWhere(item, recordValue(part) ?? {}))) {
    return false;
  }

  for (const [key, expected] of Object.entries(where)) {
    if (key === "AND" || key === "OR") continue;
    if (!matchesField(item[key], expected)) return false;
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

  if (record.lte instanceof Date) {
    return actual instanceof Date && actual <= record.lte;
  }

  if (record.path && record.equals !== undefined) {
    return nestedValue(actual, record.path) === record.equals;
  }

  return Object.entries(record).every(([key, value]) =>
    matchesField(recordValue(actual)?.[key], value)
  );
}

function nestedValue(value: unknown, path: unknown) {
  if (!Array.isArray(path)) return undefined;
  return path.reduce<unknown>((current, segment) => {
    const record = recordValue(current);
    return record ? record[String(segment)] : undefined;
  }, value);
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

function isIncrement(value: unknown): value is { increment: number } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { increment?: unknown }).increment === "number"
  );
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

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
