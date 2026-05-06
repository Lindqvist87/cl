import { prisma } from "@/lib/prisma";
import { jsonInput } from "@/lib/json";
import { stripDocumentPageMarkers } from "@/lib/document/pageMarkers";
import { hashText } from "@/lib/compiler/hash";
import { countWords } from "@/lib/text/wordCount";

export const MAX_EDITABLE_DOCUMENT_CHARS = 5_000_000;

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
      metadata: true
    }
  });

  if (!manuscript) {
    throw new ManuscriptDocumentNotFoundError();
  }

  const text = normalizeEditableManuscriptText(input.text);
  const wordCount = countWords(stripDocumentPageMarkers(text));
  const savedAt = input.now ?? new Date();
  const metadata = metadataRecord(manuscript.metadata);
  const currentEditorMetadata = metadataRecord(metadata.documentEditor);
  const textChanged = text !== (manuscript.originalText ?? "");
  const sourceHash = hashText(text);
  const nextMetadata = textChanged
    ? clearImportDerivedMetadata(metadata)
    : metadata;

  const updated = await prisma.manuscript.update({
    where: { id: input.manuscriptId },
    data: {
      originalText: text,
      wordCount,
      metadata: jsonInput({
        ...nextMetadata,
        ...(textChanged
          ? {
              sourceHash,
              roughWordCount: wordCount
            }
          : {}),
        documentEditor: {
          ...currentEditorMetadata,
          ...(textChanged
            ? {
                sourceHash,
                importManifestInvalidatedAt: savedAt.toISOString()
              }
            : {}),
          lastAutosavedAt: savedAt.toISOString(),
          revision: numberValue(currentEditorMetadata.revision) + 1
        }
      })
    },
    select: {
      id: true,
      title: true,
      originalText: true,
      wordCount: true,
      updatedAt: true
    }
  });

  return updated;
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
