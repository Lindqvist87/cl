import { NextResponse } from "next/server";
import {
  extractTextFromUpload,
  MAX_MANUSCRIPT_UPLOAD_BYTES,
  validateExtractedManuscriptText,
  validateManuscriptUploadFile,
  type ExtractedManuscriptText
} from "@/lib/parsing/extractText";
import { createUploadedManuscriptShell } from "@/lib/storage/manuscripts";

type UploadFailurePhase = "validation" | "extraction" | "storage";

type UploadedManuscriptShellForRoute = {
  id: string;
  title: string;
  wordCount: number;
  status: string;
};

export type UploadRouteDependencies = {
  extractTextFromUpload: (file: File) => Promise<ExtractedManuscriptText>;
  createUploadedManuscriptShell: (
    input: Parameters<typeof createUploadedManuscriptShell>[0]
  ) => Promise<UploadedManuscriptShellForRoute>;
};

const DOC_ONLY_UPLOAD_MESSAGE = "Dokumentet är uppladdat.";

const defaultUploadRouteDependencies: UploadRouteDependencies = {
  extractTextFromUpload,
  createUploadedManuscriptShell
};

export const uploadPostHandler = createUploadPostHandler();

const MAX_UPLOAD_FORM_BYTES = MAX_MANUSCRIPT_UPLOAD_BYTES + 1024 * 1024;

export function createUploadPostHandler(
  dependencies: UploadRouteDependencies = defaultUploadRouteDependencies
) {
  return async function POST(request: Request) {
    const contentLength = request.headers.get("content-length");
    const contentBytes = contentLength ? Number(contentLength) : null;

    if (
      contentBytes !== null &&
      Number.isFinite(contentBytes) &&
      contentBytes > MAX_UPLOAD_FORM_BYTES
    ) {
      return uploadFailureResponse(
        "validation",
        new Error("The uploaded manuscript request is too large."),
        400,
        "The uploaded manuscript request is too large."
      );
    }

    let formData: FormData;

    try {
      formData = await request.formData();
    } catch (error) {
      return uploadFailureResponse(
        "validation",
        error,
        400,
        "Unable to read upload form data."
      );
    }

    const file = formData.get("file");

    if (!(file instanceof File)) {
      return uploadFailureResponse(
        "validation",
        new Error("Missing manuscript file."),
        400,
        "Missing manuscript file."
      );
    }

    try {
      validateManuscriptUploadFile(file);
    } catch (error) {
      return uploadFailureResponse(
        "validation",
        error,
        400,
        "Invalid manuscript file."
      );
    }

    let extracted: ExtractedManuscriptText;

    try {
      extracted = await dependencies.extractTextFromUpload(file);
      validateExtractedManuscriptText(extracted);
    } catch (error) {
      return uploadFailureResponse(
        "extraction",
        error,
        400,
        "Unable to extract manuscript text."
      );
    }

    let manuscript: UploadedManuscriptShellForRoute;

    try {
      manuscript = await dependencies.createUploadedManuscriptShell({
        originalText: extracted.text,
        sourceFileName: file.name,
        sourceMimeType: extracted.mimeType,
        sourceFormat: extracted.format,
        authorName: textField(formData, "authorName"),
        targetGenre: textField(formData, "targetGenre"),
        targetAudience: textField(formData, "targetAudience"),
        importManifest: extracted.importManifest
      });
    } catch (error) {
      return uploadFailureResponse(
        "storage",
        error,
        500,
        "Unable to store uploaded manuscript."
        );
    }

    return NextResponse.json(
      {
        manuscriptId: manuscript.id,
        title: manuscript.title,
        wordCount: manuscript.wordCount,
        status: manuscript.status,
        executionMode: "DOC_ONLY",
        pipelineStarted: false,
        pipelineQueued: false,
        message: DOC_ONLY_UPLOAD_MESSAGE
      },
      { status: 201 }
    );
  };
}

function uploadFailureResponse(
  phase: UploadFailurePhase,
  error: unknown,
  status: 400 | 500,
  fallbackMessage: string
) {
  const { message } = errorDetails(error, fallbackMessage);
  logUploadFailure(phase, error, message);

  return NextResponse.json({ error: message, phase }, { status });
}

function logUploadFailure(
  phase: UploadFailurePhase,
  error: unknown,
  fallbackMessage: string
) {
  const { message, stack } = errorDetails(error, fallbackMessage);
  console.error("Upload failed", { phase, message, stack });
}

function errorDetails(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    return {
      message: error.message || fallbackMessage,
      stack: error.stack
    };
  }

  if (typeof error === "string" && error.trim()) {
    return {
      message: error,
      stack: undefined
    };
  }

  return {
    message: fallbackMessage,
    stack: undefined
  };
}

function textField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
