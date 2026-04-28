import { AnalysisPassType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasOpenAIKey, requestStructuredJson } from "@/lib/analysis/openai";
import { PROMPT_VERSION } from "@/lib/analysis/prompts";
import type { JsonRecord } from "@/lib/types";
import { jsonInput } from "@/lib/json";
import { env } from "@/lib/env";

const REWRITE_MODEL = env.OPENAI_REWRITE_MODEL;

type RewriteChunkJson = {
  rewrittenText: string;
  rationale: string[];
};

export async function rewriteChapterOne(manuscriptId: string) {
  const manuscript = await prisma.manuscript.findUnique({
    where: { id: manuscriptId },
    include: {
      chapters: {
        orderBy: { order: "asc" },
        take: 1
      },
      runs: {
        where: { status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: 1
      }
    }
  });

  if (!manuscript || manuscript.chapters.length === 0) {
    throw new Error("No first chapter found.");
  }

  const chapter = manuscript.chapters[0];
  const latestRun = manuscript.runs[0];
  const chunks = await prisma.manuscriptChunk.findMany({
    where: {
      manuscriptId,
      chapterId: chapter.id
    },
    orderBy: { chunkIndex: "asc" }
  });

  if (chunks.length === 0) {
    throw new Error("Chapter 1 has no chunks to rewrite.");
  }

  const memory = toJsonRecord(latestRun?.globalMemory);
  const rewrittenParts: string[] = [];
  const rationales: string[] = [];

  for (const chunk of chunks) {
    const output = hasOpenAIKey()
      ? await rewriteChunk({
          manuscriptTitle: manuscript.title,
          chapterTitle: chapter.title,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          memory
        })
      : {
          json: {
            rewrittenText: `[Demo rewrite placeholder for chunk ${chunk.chunkIndex}]\n\n${chunk.text}`,
            rationale: [
              "OPENAI_API_KEY is not configured, so this demo preserves the source text."
            ]
          },
          rawText: "",
          model: "stub"
        };

    rewrittenParts.push(output.json.rewrittenText);
    rationales.push(...output.json.rationale);

    if (latestRun) {
      await prisma.analysisOutput.upsert({
        where: {
          runId_passType_scopeType_scopeId: {
            runId: latestRun.id,
            passType: AnalysisPassType.REWRITE,
            scopeType: "chunk",
            scopeId: chunk.id
          }
        },
        create: {
          runId: latestRun.id,
          manuscriptId,
          passType: AnalysisPassType.REWRITE,
          scopeType: "chunk",
          scopeId: chunk.id,
          chunkId: chunk.id,
          chapterId: chapter.id,
          promptVersion: PROMPT_VERSION,
          model: output.model,
          inputSummary: jsonInput({
            chapterTitle: chapter.title,
            chunkIndex: chunk.chunkIndex
          }),
          output: jsonInput(output.json),
          rawText: output.rawText
        },
        update: {
          model: output.model,
          output: jsonInput(output.json),
          rawText: output.rawText
        }
      });
    }
  }

  return prisma.chapterRewrite.create({
    data: {
      manuscriptId,
      chapterId: chapter.id,
      runId: latestRun?.id,
      promptVersion: PROMPT_VERSION,
      model: hasOpenAIKey() ? REWRITE_MODEL : "stub",
      originalText: chapter.text,
      rewrittenText: rewrittenParts.join("\n\n"),
      changeLog: jsonInput({
        notes: rationales.slice(0, 30)
      }),
      continuityNotes: jsonInput({
        basedOnAuditRun: latestRun?.id,
        scope: "chapter-1-demo"
      }),
      status: "DRAFT",
      sourceSummary: jsonInput({
        chunkCount: chunks.length,
        basedOnAuditRun: latestRun?.id
      }),
      content: rewrittenParts.join("\n\n"),
      rationale: jsonInput({
        notes: rationales.slice(0, 30)
      })
    }
  });
}

async function rewriteChunk(input: {
  manuscriptTitle: string;
  chapterTitle: string;
  chunkIndex: number;
  text: string;
  memory: JsonRecord;
}) {
  return requestStructuredJson<RewriteChunkJson>({
    model: REWRITE_MODEL,
    system:
      "You are a careful fiction rewrite assistant. Return strict JSON only. Rewrite only the supplied chunk, preserving core events and continuity. Do not use copyrighted books as examples.",
    user: JSON.stringify(
      {
        task: "Rewrite this Chapter 1 chunk as a demo revision.",
        requiredShape: {
          rewrittenText: "rewritten prose for this chunk",
          rationale: ["brief reason for major changes"]
        },
        manuscriptTitle: input.manuscriptTitle,
        chapterTitle: input.chapterTitle,
        chunkIndex: input.chunkIndex,
        globalMemory: input.memory,
        sourceChunk: input.text
      },
      null,
      2
    )
  });
}

function toJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
