import type { ManuscriptFormat } from "@prisma/client";
import { hashText } from "@/lib/compiler/hash";
import { stripDocumentPageMarkers } from "@/lib/document/pageMarkers";
import { jsonInput } from "@/lib/json";
import { prisma } from "@/lib/prisma";
import { countWords } from "@/lib/text/wordCount";

export type LockedAnalysisSnapshot = {
  id: string;
  manuscriptId: string;
  documentRevision: number;
  textHash: string;
  wordCount: number;
  sourceFileName: string;
  sourceMimeType: string | null;
  sourceFormat: ManuscriptFormat | null;
  createdAt?: Date;
};

type SnapshotDb = {
  manuscript: {
    findUnique: (args: unknown) => Promise<{
      id: string;
      originalText: string | null;
      sourceFileName: string;
      sourceMimeType: string | null;
      sourceFormat: ManuscriptFormat;
      wordCount: number;
      metadata: unknown;
    } | null>;
  };
  analysisSnapshot: {
    upsert: (args: unknown) => Promise<LockedAnalysisSnapshot>;
  };
};

export async function createLockedAnalysisSnapshot(
  manuscriptId: string,
  db: SnapshotDb = prisma as SnapshotDb
) {
  const manuscript = await db.manuscript.findUnique({
    where: { id: manuscriptId },
    select: {
      id: true,
      originalText: true,
      sourceFileName: true,
      sourceMimeType: true,
      sourceFormat: true,
      wordCount: true,
      metadata: true
    }
  });

  if (!manuscript) {
    throw new Error("Manuscript not found.");
  }

  const sourceText = manuscript.originalText ?? "";
  const analysisText = stripDocumentPageMarkers(sourceText);
  if (!analysisText.trim()) {
    throw new Error("Manuscript has no stored source text for analysis.");
  }

  const textHash = hashText(analysisText);
  const documentRevision = documentEditorRevision(manuscript.metadata);
  const wordCount = countWords(analysisText) || manuscript.wordCount;
  const metadata = {
    documentEditorRevision: documentRevision,
    sourceTextHash: hashText(sourceText),
    sourceTextLength: sourceText.length,
    analysisTextLength: analysisText.length,
    lockedFrom: "manuscript.originalText"
  };

  return db.analysisSnapshot.upsert({
    where: {
      manuscriptId_textHash_documentRevision: {
        manuscriptId,
        textHash,
        documentRevision
      }
    },
    create: {
      manuscriptId,
      documentRevision,
      textHash,
      wordCount,
      sourceFileName: manuscript.sourceFileName,
      sourceMimeType: manuscript.sourceMimeType,
      sourceFormat: manuscript.sourceFormat,
      sourceText,
      metadata: jsonInput(metadata),
      status: "LOCKED"
    },
    update: {
      wordCount,
      sourceFileName: manuscript.sourceFileName,
      sourceMimeType: manuscript.sourceMimeType,
      sourceFormat: manuscript.sourceFormat,
      sourceText,
      metadata: jsonInput(metadata),
      status: "LOCKED"
    }
  });
}

export function snapshotRunMetadata(snapshot: LockedAnalysisSnapshot) {
  return {
    snapshotId: snapshot.id,
    textHash: snapshot.textHash,
    documentRevision: snapshot.documentRevision,
    wordCount: snapshot.wordCount,
    sourceFileName: snapshot.sourceFileName
  };
}

function documentEditorRevision(metadata: unknown) {
  const record = jsonRecord(metadata);
  const editor = jsonRecord(record.documentEditor);
  const revision = editor.revision;
  return typeof revision === "number" && Number.isFinite(revision) ? revision : 0;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

