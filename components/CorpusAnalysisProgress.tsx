"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Loader2,
  RefreshCw,
  RotateCw,
  type LucideIcon
} from "lucide-react";
import {
  CORPUS_PROGRESS_POLL_INTERVAL_MS,
  formatRelativeAge,
  getCorpusProgressAction,
  shouldPollCorpusStatus,
  staleWarningText,
  type CorpusProgressAction,
  type CorpusProgressStatus,
  type CorpusProgressStep,
  type CorpusProgressStepStatus
} from "@/lib/corpus/corpusProgressShared";

export function CorpusAnalysisProgress({
  initialStatus,
  compact = false
}: {
  initialStatus: CorpusProgressStatus;
  compact?: boolean;
}) {
  const {
    error,
    isRefreshing,
    refreshStatus,
    setStatus,
    status
  } = useCorpusStatus(initialStatus);
  const now = new Date();
  const warningText = staleWarningText(status, now);

  return (
    <div className="space-y-3">
      <div className="border border-line bg-paper p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {status.progress.isActive ? (
                <Loader2 size={16} className="animate-spin text-ink" aria-hidden="true" />
              ) : null}
              <div className="text-sm font-semibold">
                {status.progress.percent}% complete
              </div>
              {status.progress.currentStepLabel ? (
                <div className="text-sm text-slate-600">
                  Current step: {status.progress.currentStepLabel}
                </div>
              ) : null}
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden bg-white">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${status.progress.percent}%` }}
              />
            </div>
            <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
              <span>Last update: {formatRelativeAge(status.lastUpdatedAt, now)} ago</span>
              <span>
                Jobs: {status.counts.runningJobs} running,{" "}
                {status.counts.queuedJobs} queued,{" "}
                {status.counts.completedJobs} done
              </span>
              <span>Failed jobs: {status.counts.failedJobs}</span>
              <span>
                Chapters: {status.counts.chapters.toLocaleString()} | Chunks:{" "}
                {status.counts.chunks.toLocaleString()} | Embedded:{" "}
                {status.counts.embeddedChunks.toLocaleString()}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshStatus()}
            disabled={isRefreshing}
            className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 border border-line bg-white px-3 py-2 text-sm font-semibold text-ink shadow-panel disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              size={16}
              className={isRefreshing ? "animate-spin" : undefined}
              aria-hidden="true"
            />
            Refresh status
          </button>
        </div>
        {warningText ? (
          <div className="mt-3 flex flex-col gap-3 border border-danger bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2 text-sm text-danger">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{warningText}</span>
            </div>
            <CorpusActionControl
              status={status}
              onStatusChange={setStatus}
              variant="secondary"
            />
          </div>
        ) : null}
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </div>

      <div
        className={[
          "grid gap-2",
          compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"
        ].join(" ")}
      >
        {status.steps.map((step) => (
          <ProgressStep key={step.key} step={step} now={now} />
        ))}
      </div>
    </div>
  );
}

export function CorpusAnalysisAction({
  initialStatus,
  variant = "primary"
}: {
  initialStatus: CorpusProgressStatus;
  variant?: "primary" | "secondary";
}) {
  const { setStatus, status } = useCorpusStatus(initialStatus);

  return (
    <CorpusActionControl
      status={status}
      onStatusChange={setStatus}
      variant={variant}
    />
  );
}

function CorpusActionControl({
  onStatusChange,
  status,
  variant
}: {
  onStatusChange: (status: CorpusProgressStatus) => void;
  status: CorpusProgressStatus;
  variant: "primary" | "secondary";
}) {
  const action = getCorpusProgressAction(status);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (action.kind === "view_book_dna") {
    return (
      <Link
        href={action.href}
        className={buttonClassName(variant, false)}
      >
        <CheckCircle2 size={16} aria-hidden="true" />
        {action.label}
      </Link>
    );
  }

  async function runAction(actionToRun: CorpusProgressAction) {
    if (actionToRun.kind === "running" || actionToRun.kind === "view_book_dna") {
      return;
    }

    setIsRunning(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/corpus/${status.bookId}/run-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionToRun.requestAction })
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        status?: CorpusProgressStatus;
      };

      if (!response.ok) {
        setError(result.error ?? "Action failed.");
        return;
      }

      if (result.status) {
        onStatusChange(result.status);
      } else {
        const refreshed = await fetchCorpusStatus(status.bookId);
        onStatusChange(refreshed);
      }
    } catch (fetchError) {
      setError(
        fetchError instanceof Error ? fetchError.message : "Action failed."
      );
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void runAction(action)}
        disabled={action.disabled || isRunning}
        className={buttonClassName(
          variant,
          action.kind === "retry_failed"
        )}
      >
        {isRunning || action.kind === "running" ? (
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          <RotateCw size={16} aria-hidden="true" />
        )}
        {isRunning ? action.runningLabel : action.label}
      </button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function ProgressStep({
  now,
  step
}: {
  now: Date;
  step: CorpusProgressStep;
}) {
  const Icon = iconForStatus(step.status);
  const color = colorForStatus(step.status);
  const failed = step.status === "failed";

  return (
    <div className="border border-line bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2">
          <Icon
            size={16}
            className={`${color} ${step.status === "running" ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              {step.label}
            </div>
            <div className="mt-0.5 text-sm font-semibold">
              {statusLabel(step.status)}
            </div>
          </div>
        </div>
        {step.updatedAt ? (
          <div className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
            <Clock3 size={13} aria-hidden="true" />
            {formatRelativeAge(step.updatedAt, now)} ago
          </div>
        ) : null}
      </div>
      {step.detail ? (
        <p
          className={[
            "mt-2 text-xs leading-5",
            failed ? "text-danger" : "text-slate-500"
          ].join(" ")}
        >
          {step.detail}
        </p>
      ) : null}
    </div>
  );
}

function useCorpusStatus(initialStatus: CorpusProgressStatus) {
  const [status, setStatus] = useState(initialStatus);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shouldPoll = shouldPollCorpusStatus(status);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus.bookId, initialStatus.lastUpdatedAt, initialStatus]);

  const refreshStatus = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);

    try {
      const nextStatus = await fetchCorpusStatus(status.bookId);
      setStatus(nextStatus);
      return nextStatus;
    } catch (fetchError) {
      const message =
        fetchError instanceof Error
          ? fetchError.message
          : "Could not refresh corpus status.";
      setError(message);
      return null;
    } finally {
      setIsRefreshing(false);
    }
  }, [status.bookId]);

  useEffect(() => {
    if (!shouldPoll) {
      return;
    }

    let cancelled = false;
    const interval = window.setInterval(() => {
      void fetchCorpusStatus(status.bookId)
        .then((nextStatus) => {
          if (!cancelled) {
            setStatus(nextStatus);
            setError(null);
          }
        })
        .catch((fetchError) => {
          if (!cancelled) {
            setError(
              fetchError instanceof Error
                ? fetchError.message
                : "Could not refresh corpus status."
            );
          }
        });
    }, CORPUS_PROGRESS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [shouldPoll, status.bookId]);

  return {
    error,
    isRefreshing,
    refreshStatus,
    setStatus,
    status
  };
}

async function fetchCorpusStatus(bookId: string) {
  const response = await fetch(`/api/admin/corpus/${bookId}/status`, {
    cache: "no-store"
  });
  const result = (await response.json().catch(() => ({}))) as
    | CorpusProgressStatus
    | { error?: string };

  if (!response.ok) {
    throw new Error(
      "error" in result && result.error
        ? result.error
        : "Could not refresh corpus status."
    );
  }

  return result as CorpusProgressStatus;
}

function iconForStatus(status: CorpusProgressStepStatus): LucideIcon {
  switch (status) {
    case "done":
      return CheckCircle2;
    case "running":
      return Loader2;
    case "failed":
      return AlertTriangle;
    case "blocked":
    case "skipped":
      return Ban;
    case "queued":
      return CircleDashed;
  }
}

function colorForStatus(status: CorpusProgressStepStatus) {
  switch (status) {
    case "done":
      return "text-accent";
    case "running":
      return "text-ink";
    case "failed":
      return "text-danger";
    case "blocked":
    case "skipped":
      return "text-slate-500";
    case "queued":
      return "text-slate-400";
  }
}

function statusLabel(status: CorpusProgressStepStatus) {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "blocked":
      return "Blocked";
  }
}

function buttonClassName(variant: "primary" | "secondary", danger: boolean) {
  const colorClass = danger
    ? "border border-danger bg-white text-danger"
    : variant === "primary"
      ? "bg-ink text-white"
      : "border border-line bg-paper text-ink";

  return `focus-ring inline-flex min-h-9 items-center justify-center gap-2 px-3 py-2 text-sm font-semibold shadow-panel disabled:cursor-not-allowed disabled:opacity-60 ${colorClass}`;
}
