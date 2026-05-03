"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import {
  shouldPollPipelineDiagnostics,
  type PipelineDiagnosticsPollingSnapshot,
  type PipelineStatusDisplay
} from "@/lib/pipeline/display";
import {
  PIPELINE_DIAGNOSTICS_REFRESH_EVENT,
  type PipelineDiagnosticsRefreshDetail
} from "@/components/pipelineEvents";

type PipelineDiagnosticsResponse = Omit<
  PipelineDiagnosticsPollingSnapshot,
  "pipelineStatus"
> & {
  pipelineStatus?: PipelineStatusDisplay;
  error?: string;
};

export function LivePipelineProgress({
  manuscriptId,
  initialStatus,
  showTechnicalDetails = false
}: {
  manuscriptId: string;
  initialStatus: PipelineStatusDisplay;
  showTechnicalDetails?: boolean;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [diagnostics, setDiagnostics] =
    useState<PipelineDiagnosticsResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [manualNotice, setManualNotice] = useState<string | null>(null);
  const [autoRunnerActive, setAutoRunnerActive] = useState(false);

  const pollingSnapshot = useMemo<PipelineDiagnosticsPollingSnapshot>(
    () => ({
      ...(diagnostics ?? {}),
      pipelineStatus: status
    }),
    [diagnostics, status]
  );
  const shouldPoll = shouldPollPipelineDiagnostics(pollingSnapshot);
  const liveShouldPoll = shouldPoll || autoRunnerActive;
  const isBlockedByError =
    diagnostics?.state === "blocked_by_error" ||
    status.currentJobStatus === "FAILED" ||
    Boolean(status.lastError && !liveShouldPoll);
  const primaryPercent = status.stepProgress?.percent;
  const hasStepProgress = status.stepProgress !== null;
  const rewriteDraftsDeferred =
    status.coreAnalysisComplete && status.optionalRewriteDraftsPending;
  const liveStatusText = liveStatusLabel({
    isRefreshing,
    shouldPoll: liveShouldPoll,
    fetchError,
    diagnostics,
    isBlockedByError,
    autoRunnerActive,
    rewriteDraftsDeferred
  });
  const phaseLabel = humanPhaseLabel({
    status,
    diagnostics,
    isBlockedByError,
    rewriteDraftsDeferred,
    liveShouldPoll
  });
  const guidance = progressGuidance({
    status,
    isBlockedByError,
    rewriteDraftsDeferred
  });

  const refreshDiagnostics = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const response = await fetch(
        `/api/admin/manuscripts/${manuscriptId}/diagnostics`,
        { cache: "no-store" }
      );
      const nextDiagnostics =
        (await response.json().catch(() => ({}))) as PipelineDiagnosticsResponse;

      if (!response.ok) {
        throw new Error(
          typeof nextDiagnostics.error === "string"
            ? nextDiagnostics.error
            : "Could not refresh pipeline diagnostics."
        );
      }

      if (nextDiagnostics.pipelineStatus) {
        setStatus(nextDiagnostics.pipelineStatus);
      }
      setDiagnostics(nextDiagnostics);
      setLastRefreshedAt(new Date());
      setFetchError(null);
    } catch (error) {
      setFetchError(
        error instanceof Error
          ? error.message
          : "Could not refresh pipeline diagnostics."
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [manuscriptId]);

  useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  useEffect(() => {
    if (!liveShouldPoll) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshDiagnostics();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [refreshDiagnostics, liveShouldPoll]);

  useEffect(() => {
    function handleRefresh(event: Event) {
      const detail = (event as CustomEvent<PipelineDiagnosticsRefreshDetail>)
        .detail;

      if (detail?.manuscriptId !== manuscriptId) {
        return;
      }

      setAutoRunnerActive(detail.autoRunnerActive === true);
      setManualNotice(manualNoticeFromResult(detail.result));
      void refreshDiagnostics();
    }

    window.addEventListener(PIPELINE_DIAGNOSTICS_REFRESH_EVENT, handleRefresh);

    return () => {
      window.removeEventListener(
        PIPELINE_DIAGNOSTICS_REFRESH_EVENT,
        handleRefresh
      );
    };
  }, [manuscriptId, refreshDiagnostics]);

  return (
    <section className="border border-line bg-white p-4 shadow-panel">
      <div
        className={`rounded-lg border px-4 py-4 ${
          isBlockedByError
            ? "border-danger bg-white"
            : fetchError && !diagnostics
              ? "border-warn bg-white"
              : "border-line bg-white shadow-panel"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div
              className={`text-xs font-semibold uppercase tracking-wide ${
                isBlockedByError ? "text-danger" : "text-slate-500"
              }`}
            >
              Aktuell fas
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-normal text-ink">
              {phaseLabel}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-base font-semibold">
              {rewriteDraftsDeferred ? (
                <span>Redigeringsplanen är klar.</span>
              ) : status.stepProgress ? (
                <span>{humanStepProgressLabel(status.stepProgress)}</span>
              ) : fetchError && !diagnostics ? (
                <span>Aktuell status kunde inte hämtas just nu.</span>
              ) : (
                <span>{guidance}</span>
              )}
              {status.stepProgress?.remainingLabel &&
              showTechnicalDetails ? (
                <span className="text-slate-600">
                  {status.stepProgress.remainingLabel}
                </span>
              ) : null}
            </div>
            {isBlockedByError ? (
              <p className="mt-2 text-sm font-semibold text-danger">
                {status.lastError ??
                  diagnostics?.manualRunner?.message ??
                  "Analysen behöver ses över innan den kan fortsätta."}
              </p>
            ) : null}
          </div>
          <div
            className={`inline-flex min-h-8 items-center px-3 text-sm font-semibold ${
              isBlockedByError
                ? "bg-danger text-white"
                : liveShouldPoll
                  ? "bg-accent text-white"
                  : "border border-line bg-white text-slate-700"
            }`}
          >
            {liveStatusText}
          </div>
        </div>

        <div
          className="mt-4 h-5 overflow-hidden bg-white shadow-inner"
          role="progressbar"
          aria-label={`${formatStepName(status.currentStep)} fasens framsteg`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={primaryPercent ?? undefined}
          aria-valuetext={
            status.stepProgress
              ? humanStepProgressLabel(status.stepProgress)
              : liveStatusText
          }
        >
          <div
            className={`h-full ${
              isBlockedByError ? "bg-danger" : "bg-accent"
            }`}
            style={{ width: `${primaryPercent ?? 0}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-slate-600">
          <span>{liveStatusText}</span>
          <span>{lastRefreshLabel(lastRefreshedAt)}</span>
          {hasStepProgress && primaryPercent !== null ? (
            <span>{primaryPercent}% av fasen</span>
          ) : null}
        </div>
        {fetchError && !diagnostics ? (
          <p className="mt-2 text-sm font-semibold text-warn">
            Aktuell status kunde inte hämtas.
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Analysens framsteg
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {status.completedSteps} av {status.totalSteps} faser är klara
          </p>
        </div>
        <div className="inline-flex items-center gap-2 text-sm font-semibold">
          <BarChart3 size={18} aria-hidden="true" />
          {status.percent}%
        </div>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden bg-paper"
        role="progressbar"
        aria-label="Analysens framsteg"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={status.percent}
      >
        <div className="h-full bg-accent" style={{ width: `${status.percent}%` }} />
      </div>

      {showTechnicalDetails && status.lockStatus ? (
        <div className="mt-4 border border-line bg-paper px-3 py-3 text-sm">
          <div className="font-semibold">{status.lockStatus.message}</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <PipelineDetail label="Locked job" value={status.lockStatus.type} />
            <PipelineDetail
              label="Locked until"
              value={formatDisplayTime(status.lockStatus.lockExpiresAt)}
            />
            <PipelineDetail
              label="Stale"
              value={status.lockStatus.stale ? "Yes" : "No"}
            />
          </div>
        </div>
      ) : null}

      {showTechnicalDetails && manualNotice ? (
        <div className="mt-3 border border-line bg-paper px-3 py-2 text-sm font-semibold">
          {manualNotice}
        </div>
      ) : null}

      {showTechnicalDetails ? (
        <details className="detail-toggle mt-4">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink hover:text-accent">
            Teknisk information
          </summary>
          <div className="border-t border-line p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <PipelineDetail
                label="Current step"
                value={formatStepName(status.currentStep)}
              />
              <PipelineDetail
                label="Current job status"
                value={formatNullableStatus(status.currentJobStatus)}
              />
              <PipelineDetail
                label="Completed steps"
                value={`${status.completedSteps} / ${status.totalSteps}`}
              />
              <PipelineDetail
                label="Current step remaining"
                value={formatOptionalNumber(status.remainingCount)}
              />
              {typeof status.analyzedCount === "number" ? (
                <PipelineDetail
                  label="Current step completed"
                  value={status.analyzedCount.toLocaleString()}
                />
              ) : null}
              <PipelineDetail
                label="Live diagnostics"
                value={diagnostics || !fetchError ? "Available" : "Unavailable"}
              />
              <PipelineDetail label="Complete" value={String(status.complete)} />
              <PipelineDetail
                label="Last updated"
                value={formatDisplayTime(status.lastUpdatedAt)}
              />
              <PipelineDetail
                label="Next step"
                value={formatStepName(status.nextStep)}
              />
            </div>
            <div className="mt-3 rounded-lg border border-line bg-paper-alt px-3 py-2 text-sm">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Last error
              </div>
              <div className="mt-1 text-slate-700">
                {status.lastError ?? "None"}
              </div>
            </div>
          </div>
        </details>
      ) : null}
      {showTechnicalDetails && fetchError && diagnostics ? (
        <p className="mt-3 text-xs text-danger">
          Live diagnostics refresh failed: {fetchError}
        </p>
      ) : null}
    </section>
  );
}

function PipelineDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper-alt px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold">{value}</div>
    </div>
  );
}

function humanPhaseLabel(input: {
  status: PipelineStatusDisplay;
  diagnostics: PipelineDiagnosticsResponse | null;
  isBlockedByError: boolean;
  rewriteDraftsDeferred: boolean;
  liveShouldPoll: boolean;
}) {
  if (input.isBlockedByError) {
    return "Behöver ses över";
  }

  if (input.status.complete) {
    return "Analysen är klar";
  }

  if (input.rewriteDraftsDeferred) {
    return "Redigeringsplanen är klar";
  }

  if (
    input.liveShouldPoll ||
    input.status.currentStep ||
    input.diagnostics?.state === "running"
  ) {
    return humanStepName(input.status.currentStep);
  }

  return input.status.percent > 0 ? "Analysen är pausad" : "Redo för analys";
}

function progressGuidance(input: {
  status: PipelineStatusDisplay;
  isBlockedByError: boolean;
  rewriteDraftsDeferred: boolean;
}) {
  if (input.isBlockedByError) {
    return "Analysen har pausat och behöver kontrolleras.";
  }

  if (input.status.complete || input.rewriteDraftsDeferred) {
    return "Nästa steg: Öppna arbetsytan.";
  }

  if (input.status.currentStep) {
    if (input.status.currentStep === "summarizeChunks") {
      return "Det här kan ta några minuter första gången.";
    }

    return "Vi arbetar igenom manuset och uppdaterar arbetsytan när nästa fas är klar.";
  }

  return "Starta analysen för att skapa rapport, strukturöversikt och första redigeringssteg.";
}

function humanStepProgressLabel(
  progress: NonNullable<PipelineStatusDisplay["stepProgress"]>
) {
  const unit =
    progress.step === "summarizeChunks"
      ? "textdelar"
      : progress.step === "runChapterAudits"
        ? "manusdelar"
        : "delar";

  if (
    typeof progress.completed === "number" &&
    typeof progress.total === "number"
  ) {
    const remaining =
      typeof progress.remaining === "number"
        ? `, ${progress.remaining} återstår`
        : "";

    return `${progress.completed} av ${progress.total} ${unit} klara${remaining}`;
  }

  return "Fasen pågår.";
}

function manualNoticeFromResult(result: unknown) {
  const record = recordFromUnknown(result);
  const recovered = Array.isArray(record.recoveredStaleJobs)
    ? record.recoveredStaleJobs
        .map(recordFromUnknown)
        .find((job) => typeof job.type === "string")
    : null;
  const blockingJob = recordFromUnknown(record.blockingJob);
  const stoppedReason =
    typeof record.stoppedReason === "string" ? record.stoppedReason : null;

  if (typeof record.message === "string" && record.message) {
    return record.message;
  }

  if (typeof recovered?.type === "string") {
    return `Recovered stale ${recovered.type}. Run until pause again to continue.`;
  }

  if (
    record.reason === "stale_running_job_recovered" &&
    typeof blockingJob.type === "string"
  ) {
    return `Recovered stale ${blockingJob.type}. Run until pause again to continue.`;
  }

  if (
    stoppedReason === "active_running_lock" &&
    typeof blockingJob.type === "string"
  ) {
    return `Paused because ${blockingJob.type} is locked until ${
      typeof blockingJob.lockExpiresAt === "string"
        ? blockingJob.lockExpiresAt
        : "the active lock expires"
    }.`;
  }

  return null;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatNullableStatus(status: string | null) {
  return status ? formatStatus(status) : "None";
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function formatStepName(step: string | null) {
  if (!step) {
    return "None";
  }

  return step
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function humanStepName(step: string | null) {
  const labels: Record<string, string> = {
    parseAndNormalizeManuscript: "Läser in manuset",
    splitIntoChapters: "Hittar manusets delar",
    splitIntoChunks: "Förbereder textdelar",
    createEmbeddingsForChunks: "Skapar textunderlag",
    summarizeChunks: "Sammanfattar textdelar",
    summarizeChapters: "Sammanfattar manusdelar",
    createManuscriptProfile: "Bygger manusprofil",
    runChapterAudits: "Gör redaktionell genomgång",
    runWholeBookAudit: "Skapar helhetsbedömning",
    compareAgainstCorpus: "Jämför med referensbibliotek",
    compareAgainstTrendSignals: "Väger mot marknadssignaler",
    createRewritePlan: "Skapar redigeringsplan",
    generateChapterRewriteDrafts: "Skapar kapitelutkast"
  };

  return step ? labels[step] ?? "Analysen pågår" : "Redo för analys";
}

function formatOptionalNumber(value: number | null) {
  return typeof value === "number" ? value.toLocaleString() : "Unknown";
}

function formatDisplayTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Unknown";
}

function liveStatusLabel(input: {
  isRefreshing: boolean;
  shouldPoll: boolean;
  fetchError: string | null;
  diagnostics: PipelineDiagnosticsResponse | null;
  isBlockedByError: boolean;
  autoRunnerActive: boolean;
  rewriteDraftsDeferred: boolean;
}) {
  if (input.isRefreshing) {
    return "Uppdaterar...";
  }

  if (input.autoRunnerActive) {
    return "Adminbearbetning pågår";
  }

  if (input.fetchError && !input.diagnostics) {
    return "Status tillfälligt otillgänglig";
  }

  if (input.isBlockedByError) {
    return "Analysen behöver ses över";
  }

  if (input.rewriteDraftsDeferred) {
    return "Redigeringsplanen är klar";
  }

  return input.shouldPoll ? "Analysen pågår" : "Status uppdaterad";
}

function lastRefreshLabel(value: Date | null) {
  if (!value) {
    return "Senast uppdaterad: väntar";
  }

  return `Senast uppdaterad ${value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })}`;
}
