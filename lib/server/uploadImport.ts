import { NextResponse } from "next/server";
import {
  extractTextFromUpload,
  type ExtractedManuscriptText
} from "@/lib/parsing/extractText";
import {
  pipelineStartHttpStatus,
  startManuscriptPipeline
} from "@/lib/pipeline/startPipeline";
import { createUploadedManuscriptShell } from "@/lib/storage/manuscripts";

type UploadFailurePhase = "validation" | "extraction" | "storage";
type UploadLogPhase = UploadFailurePhase | "pipeline";

type UploadedManuscriptShellForRoute = {
  id: string;
  title: string;
  wordCount: number;
  status: string;
};

type PipelineStartResultForRoute = {
  executionMode: string;
  accepted: boolean;
  warnings?: string[];
  eventError?: string | null;
  [key: string]: unknown;
};

export type UploadRouteDependencies = {
  extractTextFromUpload: (file: File) => Promise<ExtractedManuscriptText>;
  createUploadedManuscriptShell: (
    input: Parameters<typeof createUploadedManuscriptShell>[0]
  ) => Promise<UploadedManuscriptShellForRoute>;
  startManuscriptPipeline: (
    input: Parameters<typeof startManuscriptPipeline>[0]
  ) => Promise<PipelineStartResultForRoute>;
};

const PIPELINE_QUEUED_MESSAGE =
  "Manuset är uppladdat och analysjobben är köade. Starta eller återuppta analysen via admin.";

const PIPELINE_NOT_STARTED_MESSAGE =
  "Manuset är uppladdat, men analysen startade inte automatiskt. Starta eller återuppta analysen via admin.";

const defaultUploadRouteDependencies: UploadRouteDependencies = {
  extractTextFromUpload,
  createUploadedManuscriptShell,
  startManuscriptPipeline
};

export const uploadPostHandler = createUploadPostHandler();

export function createUploadPostHandler(
  dependencies: UploadRouteDependencies = defaultUploadRouteDependencies
) {
  return async function POST(request: Request) {
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

    let extracted: ExtractedManuscriptText;

    try {
      extracted = await dependencies.extractTextFromUpload(file);
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
        targetAudience: textField(formData, "targetAudience")
      });
    } catch (error) {
      return uploadFailureResponse(
        "storage",
        error,
        500,
        "Unable to store uploaded manuscript."
      );
    }

    try {
      const pipeline = await dependencies.startManuscriptPipeline({
        manuscriptId: manuscript.id,
        mode: "FULL_PIPELINE",
        requestedBy: "upload",
        runInlineWhenInngestDisabled: false
      });

      if (pipeline.executionMode === "QUEUED") {
        return NextResponse.json(
          {
            manuscriptId: manuscript.id,
            title: manuscript.title,
            wordCount: manuscript.wordCount,
            status: manuscript.status,
            executionMode: "QUEUED",
            pipelineStarted: false,
            pipelineQueued: true,
            message: PIPELINE_QUEUED_MESSAGE,
            pipeline
          },
          { status: 202 }
        );
      }

      if (!pipeline.accepted) {
        const warning = pipelineWarningFromResult(pipeline);
        logUploadFailure("pipeline", new Error(warning), warning);
        return pipelineNotStartedResponse(manuscript, warning, pipeline);
      }

      return NextResponse.json(
        {
          manuscriptId: manuscript.id,
          title: manuscript.title,
          wordCount: manuscript.wordCount,
          status: manuscript.status,
          executionMode: pipeline.executionMode,
          pipelineStarted:
            pipeline.executionMode === "INNGEST" && pipeline.accepted === true,
          pipelineQueued: false,
          message: "Import started",
          pipeline
        },
        { status: pipelineStartHttpStatus(pipeline) }
      );
    } catch (error) {
      const { message } = errorDetails(
        error,
        "Unable to start background pipeline."
      );
      logUploadFailure("pipeline", error, message);
      return pipelineNotStartedResponse(manuscript, message);
    }
  };
}

function pipelineNotStartedResponse(
  manuscript: UploadedManuscriptShellForRoute,
  pipelineWarning: string,
  pipeline?: PipelineStartResultForRoute
) {
  return NextResponse.json(
    {
      manuscriptId: manuscript.id,
      title: manuscript.title,
      status: "IMPORT_QUEUED",
      executionMode: pipeline?.executionMode,
      pipelineStarted: false,
      pipelineQueued: false,
      pipelineWarning,
      message: PIPELINE_NOT_STARTED_MESSAGE,
      pipeline
    },
    { status: 202 }
  );
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
  phase: UploadLogPhase,
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

function pipelineWarningFromResult(result: PipelineStartResultForRoute) {
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const parts = [result.eventError, ...warnings].filter(
    (warning): warning is string =>
      typeof warning === "string" && warning.trim().length > 0
  );

  return parts.join(" ") || "Background pipeline was not accepted.";
}

function textField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
