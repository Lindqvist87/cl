import {
  AnalysisPassType,
  AnalysisRunStatus,
  AnalysisStatus
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AUDIT_PASSES } from "@/lib/analysis/passes";
import { hasOpenAIKey, requestStructuredJson, getConfiguredModel } from "@/lib/analysis/openai";
import {
  buildChunkAnalysisPrompt,
  buildFinalReportPrompt,
  buildPassSynthesisPrompt,
  PROMPT_VERSION
} from "@/lib/analysis/prompts";
import { auditReportToMarkdown, normalizeReport } from "@/lib/analysis/report";
import { createEmptyMemory, mergeMemory } from "@/lib/analysis/memory";
import { stubChunkOutput, stubPassSynthesis, stubReport } from "@/lib/analysis/stubs";
import type { AuditReportJson, JsonRecord, ManuscriptMemory } from "@/lib/types";
import { jsonInput } from "@/lib/json";

export async function runManuscriptAudit(manuscriptId: string) {
  const manuscript = await prisma.manuscript.findUnique({
    where: { id: manuscriptId },
    include: {
      chapters: { orderBy: { order: "asc" } },
      chunks: {
        orderBy: { chunkIndex: "asc" },
        include: { chapter: true }
      }
    }
  });

  if (!manuscript) {
    throw new Error("Manuscript not found.");
  }

  if (manuscript.chunks.length === 0) {
    throw new Error("Manuscript has no chunks to analyze.");
  }

  const run = await findOrCreateRun(manuscript.id);
  let memory = parseMemory(run.globalMemory);

  await prisma.manuscript.update({
    where: { id: manuscript.id },
    data: { analysisStatus: AnalysisStatus.RUNNING }
  });

  try {
    for (const passType of AUDIT_PASSES) {
      await prisma.analysisRun.update({
        where: { id: run.id },
        data: {
          status: AnalysisRunStatus.RUNNING,
          currentPass: passType,
          error: null
        }
      });

      for (const chunk of manuscript.chunks) {
        const existing = await prisma.analysisOutput.findUnique({
          where: {
            runId_passType_scopeType_scopeId: {
              runId: run.id,
              passType,
              scopeType: "chunk",
              scopeId: chunk.id
            }
          }
        });

        if (existing) {
          memory = mergeMemory(memory, existing.output);
          continue;
        }

        const output = await analyzeChunk({
          passType,
          manuscript: {
            title: manuscript.title,
            wordCount: manuscript.wordCount,
            chapterCount: manuscript.chapterCount
          },
          chunk: {
            id: chunk.id,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            wordCount: chunk.wordCount,
            chapterId: chunk.chapterId,
            chapterTitle: chunk.chapter.title,
            metadata: toJsonRecord(chunk.metadata)
          },
          memory
        });

        await prisma.analysisOutput.create({
          data: {
            runId: run.id,
            manuscriptId: manuscript.id,
            passType,
            scopeType: "chunk",
            scopeId: chunk.id,
            chunkId: chunk.id,
            chapterId: chunk.chapterId,
            promptVersion: PROMPT_VERSION,
            model: output.model,
            inputSummary: jsonInput({
              chunkIndex: chunk.chunkIndex,
              wordCount: chunk.wordCount,
              chapterTitle: chunk.chapter.title
            }),
            output: jsonInput(output.json),
            rawText: output.rawText
          }
        });

        memory = mergeMemory(memory, output.json);
        await saveMemory(run.id, memory, {
          passType,
          chunkIndex: chunk.chunkIndex
        });
      }

      const passSummary = await synthesizePass({
        runId: run.id,
        manuscriptId: manuscript.id,
        passType,
        manuscriptTitle: manuscript.title,
        memory
      });

      memory = mergeMemory(memory, passSummary);
      memory.passSummaries[passType] = passSummary;
      await saveMemory(run.id, memory, { passType, synthesized: true });
    }

    const report = await generateFinalReport({
      runId: run.id,
      manuscript: {
        id: manuscript.id,
        title: manuscript.title,
        wordCount: manuscript.wordCount,
        chapterCount: manuscript.chapterCount
      },
      chapterTitles: manuscript.chapters.map((chapter) => chapter.title),
      memory
    });

    await prisma.analysisRun.update({
      where: { id: run.id },
      data: {
        status: AnalysisRunStatus.COMPLETED,
        currentPass: AnalysisPassType.SYNTHESIS,
        completedAt: new Date(),
          globalMemory: jsonInput(memory),
          checkpoint: jsonInput({ completed: true })
      }
    });

    await prisma.manuscript.update({
      where: { id: manuscript.id },
      data: { analysisStatus: AnalysisStatus.COMPLETED }
    });

    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown audit failure.";

    await prisma.analysisRun.update({
      where: { id: run.id },
      data: {
        status: AnalysisRunStatus.FAILED,
        error: message,
        globalMemory: jsonInput(memory)
      }
    });

    await prisma.manuscript.update({
      where: { id: manuscript.id },
      data: { analysisStatus: AnalysisStatus.FAILED }
    });

    throw error;
  }
}

async function findOrCreateRun(manuscriptId: string) {
  const existing = await prisma.analysisRun.findFirst({
    where: {
      manuscriptId,
      status: { in: [AnalysisRunStatus.RUNNING, AnalysisRunStatus.FAILED] }
    },
    orderBy: { createdAt: "desc" }
  });

  if (existing) {
    return prisma.analysisRun.update({
      where: { id: existing.id },
      data: {
        status: AnalysisRunStatus.RUNNING,
        error: null
      }
    });
  }

  return prisma.analysisRun.create({
    data: {
      manuscriptId,
      status: AnalysisRunStatus.RUNNING,
      globalMemory: jsonInput(createEmptyMemory())
    }
  });
}

async function analyzeChunk(input: {
  passType: AnalysisPassType;
  manuscript: {
    title: string;
    wordCount: number;
    chapterCount: number;
  };
  chunk: {
    id: string;
    chunkIndex: number;
    text: string;
    wordCount: number;
    chapterId: string;
    chapterTitle: string;
    metadata?: JsonRecord;
  };
  memory: ManuscriptMemory;
}) {
  const model = getConfiguredModel();

  if (!hasOpenAIKey()) {
    const json = stubChunkOutput({
      passType: input.passType,
      chunkIndex: input.chunk.chunkIndex,
      chapterTitle: input.chunk.chapterTitle,
      wordCount: input.chunk.wordCount
    });

    return {
      json,
      rawText: JSON.stringify(json),
      model: "stub"
    };
  }

  const prompt = buildChunkAnalysisPrompt({
    passType: input.passType,
    manuscript: input.manuscript,
    chunk: {
      chunkIndex: input.chunk.chunkIndex,
      chapterTitle: input.chunk.chapterTitle,
      wordCount: input.chunk.wordCount,
      text: input.chunk.text,
      metadata: input.chunk.metadata
    },
    memory: input.memory
  });

  return requestStructuredJson<JsonRecord>({
    ...prompt,
    model
  });
}

async function synthesizePass(input: {
  runId: string;
  manuscriptId: string;
  passType: AnalysisPassType;
  manuscriptTitle: string;
  memory: ManuscriptMemory;
}) {
  const existing = await prisma.analysisOutput.findUnique({
    where: {
      runId_passType_scopeType_scopeId: {
        runId: input.runId,
        passType: input.passType,
        scopeType: "pass",
        scopeId: input.passType
      }
    }
  });

  if (existing) {
    return toJsonRecord(existing.output);
  }

  const chunkOutputs = await prisma.analysisOutput.findMany({
    where: {
      runId: input.runId,
      passType: input.passType,
      scopeType: "chunk"
    },
    orderBy: { createdAt: "asc" }
  });

  const summaries = await getPassSynthesisInputs({
    runId: input.runId,
    manuscriptId: input.manuscriptId,
    passType: input.passType,
    manuscriptTitle: input.manuscriptTitle,
    memory: input.memory,
    chunkOutputs
  });
  const model = getConfiguredModel();
  const result = hasOpenAIKey()
    ? await requestStructuredJson<JsonRecord>({
        ...buildPassSynthesisPrompt({
          passType: input.passType,
          manuscriptTitle: input.manuscriptTitle,
          chunkSummaries: summaries,
          memory: input.memory
        }),
        model
      })
    : {
        json: stubPassSynthesis({
          passType: input.passType,
          chunkCount: chunkOutputs.length
        }),
        rawText: "",
        model: "stub"
      };

  await prisma.analysisOutput.create({
    data: {
      runId: input.runId,
      manuscriptId: input.manuscriptId,
      passType: input.passType,
      scopeType: "pass",
      scopeId: input.passType,
      promptVersion: PROMPT_VERSION,
      model: result.model,
      inputSummary: jsonInput({
        sourceChunkOutputCount: chunkOutputs.length
      }),
      output: jsonInput(result.json),
      rawText: result.rawText
    }
  });

  return result.json;
}

async function getPassSynthesisInputs(input: {
  runId: string;
  manuscriptId: string;
  passType: AnalysisPassType;
  manuscriptTitle: string;
  memory: ManuscriptMemory;
  chunkOutputs: Array<{ output: unknown }>;
}) {
  const batchSize = 30;
  const chunkSummaries = input.chunkOutputs.map((output) =>
    summarizeOutput(output.output)
  );

  if (chunkSummaries.length <= batchSize) {
    return chunkSummaries;
  }

  const batchSummaries: JsonRecord[] = [];

  for (let start = 0; start < chunkSummaries.length; start += batchSize) {
    const batchIndex = Math.floor(start / batchSize);
    const scopeId = `${input.passType}:batch:${batchIndex}`;
    const existing = await prisma.analysisOutput.findUnique({
      where: {
        runId_passType_scopeType_scopeId: {
          runId: input.runId,
          passType: input.passType,
          scopeType: "pass-batch",
          scopeId
        }
      }
    });

    if (existing) {
      batchSummaries.push(toJsonRecord(existing.output));
      continue;
    }

    const sourceSummaries = chunkSummaries.slice(start, start + batchSize);
    const model = getConfiguredModel();
    const result = hasOpenAIKey()
      ? await requestStructuredJson<JsonRecord>({
          ...buildPassSynthesisPrompt({
            passType: input.passType,
            manuscriptTitle: input.manuscriptTitle,
            chunkSummaries: sourceSummaries,
            memory: input.memory
          }),
          model
        })
      : {
          json: stubPassSynthesis({
            passType: input.passType,
            chunkCount: sourceSummaries.length
          }),
          rawText: "",
          model: "stub"
        };

    await prisma.analysisOutput.create({
      data: {
        runId: input.runId,
        manuscriptId: input.manuscriptId,
        passType: input.passType,
        scopeType: "pass-batch",
        scopeId,
        promptVersion: PROMPT_VERSION,
        model: result.model,
        inputSummary: jsonInput({
          batchIndex,
          sourceChunkOutputCount: sourceSummaries.length
        }),
        output: jsonInput(result.json),
        rawText: result.rawText
      }
    });

    batchSummaries.push(result.json);
  }

  return batchSummaries.map(summarizeOutput);
}

async function generateFinalReport(input: {
  runId: string;
  manuscript: {
    id: string;
    title: string;
    wordCount: number;
    chapterCount: number;
  };
  chapterTitles: string[];
  memory: ManuscriptMemory;
}) {
  const existing = await prisma.auditReport.findUnique({
    where: { runId: input.runId }
  });

  if (existing) {
    return existing;
  }

  const passOutputs = await prisma.analysisOutput.findMany({
    where: {
      runId: input.runId,
      scopeType: "pass"
    },
    orderBy: { createdAt: "asc" }
  });

  const passSummaries = passOutputs.map((output) => toJsonRecord(output.output));
  const model = getConfiguredModel();
  const result = hasOpenAIKey()
    ? await requestStructuredJson<AuditReportJson>({
        ...buildFinalReportPrompt({
          manuscript: {
            title: input.manuscript.title,
            wordCount: input.manuscript.wordCount,
            chapterCount: input.manuscript.chapterCount
          },
          passSummaries,
          chapterTitles: input.chapterTitles,
          memory: input.memory
        }),
        model
      })
    : {
        json: stubReport({
          title: input.manuscript.title,
          chapterTitles: input.chapterTitles,
          memory: input.memory
        }),
        rawText: "",
        model: "stub"
      };

  const normalized = normalizeReport(result.json);
  const markdown = auditReportToMarkdown(normalized, input.manuscript.title);

  await prisma.analysisOutput.create({
    data: {
      runId: input.runId,
      manuscriptId: input.manuscript.id,
      passType: AnalysisPassType.SYNTHESIS,
      scopeType: "manuscript",
      scopeId: input.manuscript.id,
      promptVersion: PROMPT_VERSION,
      model: result.model,
      inputSummary: jsonInput({
        sourcePassOutputCount: passOutputs.length
      }),
      output: jsonInput(normalized),
      rawText: result.rawText
    }
  });

  return prisma.auditReport.create({
    data: {
      manuscriptId: input.manuscript.id,
      runId: input.runId,
      executiveSummary: normalized.executiveSummary,
      topIssues: jsonInput(normalized.topIssues),
      chapterNotes: jsonInput(normalized.chapterNotes),
      rewriteStrategy: normalized.rewriteStrategy,
      structured: jsonInput(normalized),
      markdown
    }
  });
}

function parseMemory(value: unknown): ManuscriptMemory {
  if (value && typeof value === "object") {
    return {
      ...createEmptyMemory(),
      ...(value as Partial<ManuscriptMemory>),
      characters: Array.isArray((value as ManuscriptMemory).characters)
        ? (value as ManuscriptMemory).characters
        : [],
      plotThreads: Array.isArray((value as ManuscriptMemory).plotThreads)
        ? (value as ManuscriptMemory).plotThreads
        : [],
      settingNotes: Array.isArray((value as ManuscriptMemory).settingNotes)
        ? (value as ManuscriptMemory).settingNotes
        : [],
      styleNotes: Array.isArray((value as ManuscriptMemory).styleNotes)
        ? (value as ManuscriptMemory).styleNotes
        : [],
      risks: Array.isArray((value as ManuscriptMemory).risks)
        ? (value as ManuscriptMemory).risks
        : [],
      passSummaries:
        typeof (value as ManuscriptMemory).passSummaries === "object"
          ? (value as ManuscriptMemory).passSummaries
          : {}
    };
  }

  return createEmptyMemory();
}

async function saveMemory(
  runId: string,
  memory: ManuscriptMemory,
  checkpoint: JsonRecord
) {
  await prisma.analysisRun.update({
    where: { id: runId },
    data: {
      globalMemory: jsonInput(memory),
      checkpoint: jsonInput(checkpoint)
    }
  });
}

function summarizeOutput(output: unknown): JsonRecord {
  const record = toJsonRecord(output);
  return {
    summary: record.summary ?? record.passSummary,
    findings: record.findings ?? record.keyIssues,
    chapterNotes: record.chapterNotes,
    memoryUpdates: record.memoryUpdates
  };
}

function toJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
