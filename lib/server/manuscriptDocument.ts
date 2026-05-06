import { prisma } from "@/lib/prisma";
import { jsonInput } from "@/lib/json";
import { stripDocumentPageMarkers } from "@/lib/document/pageMarkers";
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

  const updated = await prisma.manuscript.update({
    where: { id: input.manuscriptId },
    data: {
      originalText: text,
      wordCount,
      metadata: jsonInput({
        ...metadata,
        documentEditor: {
          ...currentEditorMetadata,
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

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
