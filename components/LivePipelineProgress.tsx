"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Sparkles
} from "lucide-react";
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

type OptimisticPhase = "starting" | "running" | null;

export function LivePipelineProgress({
  manuscriptId,
  initialStatus,
  analysisStatus,
  showTechnicalDetails = false
}: {
  manuscriptId: string;
  initialStatus: PipelineStatusDisplay;
  analysisStatus?: string;
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
  const [optimisticPhase, setOptimisticPhase] =
    useState<OptimisticPhase>(null);
  const refreshInFlightRef = useRef(false);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  const pollingSnapshot = useMemo<PipelineDiagnosticsPollingSnapshot>(
    () => ({
      ...(diagnostics ?? {}),
      pipelineStatus: status
    }),
    [diagnostics, status]
  );
  const shouldPoll = shouldPollPipelineDiagnostics(pollingSnapshot);
  const analysisIsRunning =
    analysisStatus?.toUpperCase() === "RUNNING" &&
    diagnostics?.state !== "blocked_by_error" &&
    !status.complete &&
    status.currentJobStatus !== "FAILED";
  const liveShouldPoll =
    shouldPoll ||
    analysisIsRunning ||
    autoRunnerActive ||
    optimisticPhase === "starting" ||
    optimisticPhase === "running";
  const isBlockedByError =
    diagnostics?.state === "blocked_by_error" ||
    analysisStatus?.toUpperCase() === "FAILED" ||
    status.currentJobStatus === "FAILED" ||
    Boolean(status.lastError && !liveShouldPoll);
  const isWaitingForNextPhase =
    !isBlockedByError &&
    (status.currentJobStatus === "BLOCKED" ||
      diagnostics?.manualRunner?.reason === "waiting_for_lock_expiry" ||
      (diagnostics?.state === "more_work_remains" &&
        !diagnostics.nextEligibleJob &&
        (diagnostics.remainingJobCount ?? 0) > 0));
  const rewriteDraftsDeferred =
    status.coreAnalysisComplete && status.optionalRewriteDraftsPending;
  const phaseLabel = humanPhaseLabel({
    status,
    isBlockedByError,
    isWaitingForNextPhase,
    optimisticPhase,
    rewriteDraftsDeferred,
    liveShouldPoll
  });
  const guidance = progressGuidance({
    status,
    isBlockedByError,
    isWaitingForNextPhase,
    optimisticPhase,
    rewriteDraftsDeferred,
    liveShouldPoll
  });
  const liveStatusText = liveStatusLabel({
    isRefreshing,
    liveShouldPoll,
    fetchError,
    diagnostics,
    isBlockedByError,
    isWaitingForNextPhase,
    optimisticPhase,
    rewriteDraftsDeferred
  });
  const stepPercent = status.stepProgress?.percent;
  const displayPercent = clampPercent(
    typeof stepPercent === "number" ? stepPercent : status.percent
  );
  const showIndeterminateProgress =
    liveShouldPoll &&
    !status.complete &&
    typeof stepPercent !== "number" &&
    status.percent === 0;
  const percentScope =
    typeof stepPercent === "number" ? "av fasen" : "av analysen";
  const stepProgressLabel = status.stepProgress
    ? humanStepProgressLabel(status.stepProgress)
    : null;
  const statusIcon = isBlockedByError
    ? AlertTriangle
    : status.complete || rewriteDraftsDeferred
      ? CheckCircle2
      : liveShouldPoll
        ? LoaderCircle
        : Sparkles;
  const StatusIcon = statusIcon;
  const statusIconSpins =
    statusIcon === LoaderCircle && liveShouldPoll && !isBlockedByError;

  const refreshDiagnostics = useCallback(async () => {
    if (refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
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

      const nextStatus = nextDiagnostics.pipelineStatus;
      const nextSnapshot: PipelineDiagnosticsPollingSnapshot = {
        ...nextDiagnostics,
        pipelineStatus: nextStatus
      };

      if (
        nextStatus?.complete ||
        nextDiagnostics.state === "done" ||
        nextDiagnostics.state === "blocked_by_error" ||
        nextStatus?.currentJobStatus === "FAILED"
      ) {
        setOptimisticPhase(null);
        setAutoRunnerActive(false);
      } else if (shouldPollPipelineDiagnostics(nextSnapshot)) {
        setOptimisticPhase("running");
      }
    } catch (error) {
      setFetchError(
        error instanceof Error
          ? error.message
          : "Could not refresh pipeline diagnostics."
      );
    } finally {
      refreshInFlightRef.current = false;
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
    }, 3000);

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

      if (detail.phase === "starting") {
        setOptimisticPhase("starting");
      } else if (detail.phase === "running" || detail.autoRunnerActive) {
        setOptimisticPhase("running");
      } else if (detail.phase === "failed" || detail.phase === "idle") {
        setOptimisticPhase(null);
      }

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
    <section className="overflow-hidden rounded-xl border border-accent/15 bg-[#fffdfc] p-4 shadow-panel sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                isBlockedByError
                  ? "border-danger/20 bg-red-50 text-danger"
                  : "border-accent/15 bg-accent/10 text-accent"
              }`}
            >
              <StatusIcon
                size={18}
                aria-hidden="true"
                className={statusIconSpins ? "animate-spin" : undefined}
              />
            </span>
            <span className="inline-flex min-h-8 items-center rounded-full border border-line bg-white px-3 text-sm font-semibold text-slate-700">
              {liveStatusText}
            </span>
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-normal text-ink sm:text-3xl">
            {phaseLabel}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700 sm:text-base">
            {guidance}
          </p>
        </div>

        <div className="shrink-0 rounded-lg border border-accent/15 bg-white px-4 py-3 text-left sm:text-right">
          <div className="text-3xl font-semibold tracking-normal text-accent">
            {displayPercent}%
          </div>
          <div className="mt-1 text-xs font-semibold uppercase text-slate-500">
            {percentScope}
          </div>
        </div>
      </div>

      <div
        className="mt-5 h-3 w-full overflow-hidden rounded-full bg-accent/10"
        role="progressbar"
        aria-label="Analysens framsteg"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={showIndeterminateProgress ? undefined : displayPercent}
        aria-valuetext={
          showIndeterminateProgress
            ? "Analysen startar"
            : `${displayPercent}% ${percentScope}`
        }
      >
        {showIndeterminateProgress ? (
          <div className="paperlight-progress-indeterminate h-full rounded-full bg-accent" />
        ) : (
          <div
            className={`relative h-full overflow-hidden rounded-full transition-[width] duration-500 ease-out ${
              isBlockedByError ? "bg-danger" : "bg-accent"
            }`}
            style={{ width: `${displayPercent}%` }}
          >
            {liveShouldPoll && !isBlockedByError ? (
              <span className="paperlight-progress-shimmer absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/45 to-transparent" />
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <span className="font-semibold text-ink">
            {status.completedSteps} av {status.totalSteps} faser klara
          </span>
          {stepProgressLabel ? <span>{stepProgressLabel}</span> : null}
          {isWaitingForNextPhase ? (
            <span>Nästa fas startar strax</span>
          ) : null}
        </div>
        <div className="inline-flex items-center gap-2 font-semibold text-slate-500">
          <Clock3 size={16} aria-hidden="true" />
          {lastUpdatedLabel(status.lastUpdatedAt, lastRefreshedAt)}
        </div>
      </div>

      {fetchError && !diagnostics ? (
        <p className="mt-3 text-sm font-semibold text-warn">
          Status kunde inte hämtas just nu. Vi försöker igen om en stund.
        </p>
      ) : null}

      {showTechnicalDetails ? (
        <details className="detail-toggle mt-5 overflow-hidden shadow-none">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink hover:text-accent">
            Teknisk information
          </summary>
          <div className="space-y-4 border-t border-line p-4">
            {status.lockStatus ? (
              <div className="border border-line bg-paper-alt px-3 py-3 text-sm">
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

            {manualNotice ? (
              <div className="border border-line bg-paper-alt px-3 py-2 text-sm font-semibold">
                {manualNotice}
              </div>
            ) : null}

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

            <div className="rounded-lg border border-line bg-paper-alt px-3 py-2 text-sm">
              <div className="text-xs uppercase text-slate-500">Last error</div>
              <div className="mt-1 break-words text-slate-700">
                {status.lastError ?? "None"}
              </div>
            </div>

            {fetchError && diagnostics ? (
              <p className="text-xs text-danger">
                Live diagnostics refresh failed: {fetchError}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function PipelineDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold">{value}</div>
    </div>
  );
}

function humanPhaseLabel(input: {
  status: PipelineStatusDisplay;
  isBlockedByError: boolean;
  isWaitingForNextPhase: boolean;
  optimisticPhase: OptimisticPhase;
  rewriteDraftsDeferred: boolean;
  liveShouldPoll: boolean;
}) {
  if (input.isBlockedByError) {
    return "Analysen kunde inte slutföras";
  }

  if (input.status.complete) {
    return "Analysen är klar";
  }

  if (input.rewriteDraftsDeferred) {
    return "Skapar arbetsyta";
  }

  if (input.optimisticPhase === "starting") {
    return "Analysen startar";
  }

  if (input.isWaitingForNextPhase) {
    return "Nästa fas startar strax";
  }

  if (input.liveShouldPoll || input.status.currentStep) {
    return humanStepName(input.status.currentStep);
  }

  return input.status.percent > 0 ? "Väntar på nästa fas" : "Analysen startar";
}

function progressGuidance(input: {
  status: PipelineStatusDisplay;
  isBlockedByError: boolean;
  isWaitingForNextPhase: boolean;
  optimisticPhase: OptimisticPhase;
  rewriteDraftsDeferred: boolean;
  liveShouldPoll: boolean;
}) {
  if (input.isBlockedByError) {
    return "Analysen kunde inte slutföras. Öppna teknisk information om du vill se vad som behöver kontrolleras.";
  }

  if (input.status.complete) {
    return "Analysen är klar och arbetsytan är uppdaterad.";
  }

  if (input.rewriteDraftsDeferred) {
    return "Redigeringsplanen är klar. Arbetsytan kan öppnas medan nästa material förbereds.";
  }

  if (input.optimisticPhase === "starting") {
    return "Vi har tagit emot starten och förbereder första fasen. Statusen uppdateras automatiskt.";
  }

  if (input.isWaitingForNextPhase) {
    return "Vi väntar in nästa trygga fas och fortsätter uppdatera sidan automatiskt.";
  }

  if (input.liveShouldPoll || input.status.currentStep) {
    return "Vi arbetar genom manuset. Du kan låta sidan vara öppen så fortsätter statusen att uppdateras.";
  }

  return "Starta analysen för att skapa rapport, strukturöversikt och första redigeringssteg.";
}

function humanStepProgressLabel(
  progress: NonNullable<PipelineStatusDisplay["stepProgress"]>
) {
  const unit =
    progress.step === "summarizeChunks"
      ? "avsnitt"
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
    splitIntoChapters: "Skapar textunderlag",
    splitIntoChunks: "Skapar textunderlag",
    createEmbeddingsForChunks: "Skapar textunderlag",
    summarizeChunks: "Sammanfattar kapitel",
    summarizeChapters: "Sammanfattar kapitel",
    createManuscriptProfile: "Bygger redaktionell karta",
    runChapterAudits: "Bygger redaktionell karta",
    runWholeBookAudit: "Tar fram rekommendationer",
    compareAgainstCorpus: "Tar fram rekommendationer",
    compareAgainstTrendSignals: "Tar fram rekommendationer",
    createRewritePlan: "Tar fram rekommendationer",
    generateChapterRewriteDrafts: "Skapar arbetsyta"
  };

  return step ? labels[step] ?? "Analysen pågår" : "Analysen startar";
}

function formatOptionalNumber(value: number | null) {
  return typeof value === "number" ? value.toLocaleString() : "Unknown";
}

function formatDisplayTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Unknown";
}

function liveStatusLabel(input: {
  isRefreshing: boolean;
  liveShouldPoll: boolean;
  fetchError: string | null;
  diagnostics: PipelineDiagnosticsResponse | null;
  isBlockedByError: boolean;
  isWaitingForNextPhase: boolean;
  optimisticPhase: OptimisticPhase;
  rewriteDraftsDeferred: boolean;
}) {
  if (input.isRefreshing) {
    return "Status uppdateras";
  }

  if (input.optimisticPhase === "starting") {
    return "Analysen startar";
  }

  if (input.fetchError && !input.diagnostics) {
    return "Status uppdateras strax";
  }

  if (input.isBlockedByError) {
    return "Analysen kunde inte slutföras";
  }

  if (input.rewriteDraftsDeferred) {
    return "Skapar arbetsyta";
  }

  if (input.isWaitingForNextPhase) {
    return "Nästa fas startar strax";
  }

  return input.liveShouldPoll ? "Analysen pågår" : "Status uppdaterad";
}

function lastUpdatedLabel(value: string | null, refreshedAt: Date | null) {
  const date = value ? new Date(value) : refreshedAt;

  if (!date) {
    return "Väntar på status";
  }

  return `Status uppdaterad ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })}`;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}
