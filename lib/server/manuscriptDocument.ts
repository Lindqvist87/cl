import { AnalysisStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { jsonInput } from "@/lib/json";
import { stripDocumentPageMarkers } from "@/lib/document/pageMarkers";
import { hashText } from "@/lib/compiler/hash";
import {
  importSignatureFromManifest,
  metadataWithImportManifest
} from "@/lib/import/v2/manifest";
import { buildTextImportManifest } from "@/lib/import/v2/text";
import { countWords } from "@/lib/text/wordCount";

export const MAX_EDITABLE_DOCUMENT_CHARS = 5_000_000;
const EDITABLE_DOCUMENT_TRANSACTION = {
  maxWait: 10_000,
  timeout: 120_000
} as const;

type SaveEditableManuscriptDocumentInput = {
  manuscriptId: string;
  text: string;
  now?: Date;
};

export class ManuscriptDocumentNotFoundError extends Error {
  constructor() {
    super("Manuscript not found.");
    this.name = "ManuscriptDocumentNotFoundError";
  }
}

export class ManuscriptDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManuscriptDocumentValidationError";
  }
}

export function normalizeEditableManuscriptText(input: string) {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+\n/g, "\n");
}

export async function saveEditableManuscriptDocument(
  input: SaveEditableManuscriptDocumentInput
) {
  if (input.text.length > MAX_EDITABLE_DOCUMENT_CHARS) {
    throw new ManuscriptDocumentValidationError(
      `Document text is too large. The maximum is ${MAX_EDITABLE_DOCUMENT_CHARS} characters.`
    );
  }

  const manuscript = await prisma.manuscript.findUnique({
    where: { id: input.manuscriptId },
    select: {
      id: true,
      originalText: true,
      sourceFileName: true,
      sourceMimeType: true,
      metadata: true
    }
  });

  if (!manuscript) {
    throw new ManuscriptDocumentNotFoundError();
  }

  const text = normalizeEditableManuscriptText(input.text);
  const analysisText = stripDocumentPageMarkers(text);
  const wordCount = countWords(analysisText);
  const savedAt = input.now ?? new Date();
  const metadata = metadataRecord(manuscript.metadata);
  const currentEditorMetadata = metadataRecord(metadata.documentEditor);
  const textChanged = text !== (manuscript.originalText ?? "");

  if (wordCount === 0) {
    throw new ManuscriptDocumentValidationError(
      "No readable manuscript text was found in the document."
    );
  }

  const sourceHash = hashText(analysisText);
  const nextMetadata = editableDocumentMetadata({
    metadata,
    currentEditorMetadata,
    textChanged,
    analysisText,
    sourceFileName: manuscript.sourceFileName,
    sourceMimeType: manuscript.sourceMimeType ?? undefined,
    sourceHash,
    wordCount,
    savedAt
  });
  const data: Prisma.ManuscriptUpdateInput = {
    originalText: text,
    wordCount,
    metadata: jsonInput(nextMetadata),
    ...(textChanged
      ? {
          chapterCount: 0,
          paragraphCount: 0,
          chunkCount: 0,
          status: "UPLOADED",
          analysisStatus: AnalysisStatus.NOT_STARTED
        }
      : {})
  };

  if (textChanged) {
    return prisma.$transaction(async (tx) => {
      await deleteEditableDocumentDerivedState(tx, input.manuscriptId);

      return tx.manuscript.update({
        where: { id: input.manuscriptId },
        data,
        select: editableDocumentSelect()
      });
    }, EDITABLE_DOCUMENT_TRANSACTION);
  }

  const updated = await prisma.manuscript.update({
    where: { id: input.manuscriptId },
    data,
    select: editableDocumentSelect()
  });

  return updated;
}

function editableDocumentSelect() {
  return {
    id: true,
    title: true,
    originalText: true,
    wordCount: true,
    updatedAt: true
  } as const;
}

function editableDocumentMetadata(input: {
  metadata: Record<string, unknown>;
  currentEditorMetadata: Record<string, unknown>;
  textChanged: boolean;
  analysisText: string;
  sourceFileName: string;
  sourceMimeType?: string;
  sourceHash: string;
  wordCount: number;
  savedAt: Date;
}) {
  if (!input.textChanged) {
    return {
      ...input.metadata,
      documentEditor: {
        ...input.currentEditorMetadata,
        lastAutosavedAt: input.savedAt.toISOString(),
        revision: numberValue(input.currentEditorMetadata.revision) + 1
      }
    };
  }

  const manifest = buildTextImportManifest({
    rawText: input.analysisText,
    sourceFileName: input.sourceFileName,
    sourceMimeType: input.sourceMimeType,
    fileHash: input.sourceHash
  });
  const importSignature = importSignatureFromManifest(manifest);

  return metadataWithImportManifest(
    {
      ...clearImportDerivedMetadata(input.metadata),
      compilerVersion: "compiler-v1",
      importFlow: "doc-only",
      sourceHash: input.sourceHash,
      roughWordCount: input.wordCount,
      importSignature,
      documentEditor: {
        ...input.currentEditorMetadata,
        sourceHash: input.sourceHash,
        importManifestInvalidatedAt: input.savedAt.toISOString(),
        analysisSourceUpdatedAt: input.savedAt.toISOString(),
        lastAutosavedAt: input.savedAt.toISOString(),
        revision: numberValue(input.currentEditorMetadata.revision) + 1
      }
    },
    manifest
  );
}

async function deleteEditableDocumentDerivedState(
  tx: Prisma.TransactionClient,
  manuscriptId: string
) {
  await tx.editorialDecision.deleteMany({ where: { manuscriptId } });
  await tx.chapterRewrite.deleteMany({ where: { manuscriptId } });
  await tx.rewritePlan.deleteMany({ where: { manuscriptId } });
  await tx.auditReport.deleteMany({ where: { manuscriptId } });
  await tx.finding.deleteMany({ where: { manuscriptId } });
  await tx.analysisOutput.deleteMany({ where: { manuscriptId } });
  await tx.manuscriptProfile.deleteMany({ where: { manuscriptId } });
  await tx.compilerArtifact.deleteMany({ where: { manuscriptId } });
  await tx.manuscriptNode.deleteMany({ where: { manuscriptId } });
  await tx.narrativeFact.deleteMany({ where: { manuscriptId } });
  await tx.characterState.deleteMany({ where: { manuscriptId } });
  await tx.plotEvent.deleteMany({ where: { manuscriptId } });
  await tx.styleFingerprint.deleteMany({ where: { manuscriptId } });
  await tx.manuscriptChunk.deleteMany({ where: { manuscriptId } });
  await tx.paragraph.deleteMany({ where: { manuscriptId } });
  await tx.scene.deleteMany({ where: { manuscriptId } });
  await tx.manuscriptChapter.deleteMany({ where: { manuscriptId } });
  await tx.pipelineJob.deleteMany({ where: { manuscriptId } });
  await tx.analysisRun.deleteMany({ where: { manuscriptId } });
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function clearImportDerivedMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...metadata };
  delete next.importManifestV2;
  delete next.importManifest;
  delete next.importV2;
  delete next.importSignature;
  delete next.structureReview;
  delete next.importReview;

  const importMetadata = metadataRecord(next.import);
  delete importMetadata.importSignature;
  delete importMetadata.normalizedAt;
  delete importMetadata.normalizedTextHash;
  delete importMetadata.parserVersion;
  delete importMetadata.sourceHash;
  delete importMetadata.structureHash;

  if (Object.keys(importMetadata).length > 0) {
    next.import = importMetadata;
  } else {
    delete next.import;
  }

  return next;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
