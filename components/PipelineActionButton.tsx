"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { PIPELINE_DIAGNOSTICS_REFRESH_EVENT } from "@/components/pipelineEvents";

export function PipelineActionButton({
  endpoint,
  payload,
  label,
  runningLabel,
  variant = "secondary",
  diagnosticsRefreshManuscriptId,
  refreshPageOnComplete = true,
  fullWidth = false
}: {
  endpoint: string;
  fullWidth?: boolean;
  payload?: Record<string, unknown>;
  label: string;
  runningLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  diagnosticsRefreshManuscriptId?: string;
  refreshPageOnComplete?: boolean;
}) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineActionResult | null>(null);

  async function runAction() {
    setIsRunning(true);
    setError(null);
    setResult(null);
    dispatchDiagnosticsRefresh(null, true);

    let response: Response;
    let nextResult: PipelineActionResult;

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {})
      });
      nextResult = (await response.json().catch(() => ({}))) as PipelineActionResult;
    } catch (fetchError) {
      setIsRunning(false);
      setError(
        fetchError instanceof Error ? fetchError.message : "Action failed."
      );
      dispatchDiagnosticsRefresh(null, false);
      return;
    }

    setIsRunning(false);
    dispatchDiagnosticsRefresh(nextResult, false);

    if (!response.ok) {
      setError(nextResult.error ?? "Action failed.");
      return;
    }

    setResult(nextResult);
    if (refreshPageOnComplete) {
      router.refresh();
    }
  }

  function dispatchDiagnosticsRefresh(
    result: PipelineActionResult | null,
    autoRunnerActive?: boolean
  ) {
    if (!diagnosticsRefreshManuscriptId) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent(PIPELINE_DIAGNOSTICS_REFRESH_EVENT, {
        detail: {
          manuscriptId: diagnosticsRefreshManuscriptId,
          result,
          autoRunnerActive
        }
      })
    );
  }

  const className =
    variant === "primary"
      ? "bg-accent text-white shadow-button hover:bg-accent-dark"
      : variant === "danger"
        ? "border border-danger bg-white text-danger"
        : "border border-line bg-white text-ink hover:border-accent/50 hover:text-accent";

  return (
    <div className={fullWidth ? "flex w-full flex-col gap-1" : "flex flex-col gap-1"}>
      <button
        type="button"
        onClick={runAction}
        disabled={isRunning}
        className={`focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${fullWidth ? "w-full" : ""} ${className}`}
      >
        <RotateCw size={16} aria-hidden="true" />
        {isRunning ? runningLabel ?? "Working..." : label}
      </button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {result ? <PipelineActionSummary result={result} /> : null}
    </div>
  );
}

type PipelineActionResult = {
  error?: string;
  batchesRun?: number;
  totalJobsRun?: number;
  stoppedReason?: string;
  jobsRun?: number;
  remainingReadyJobs?: number;
  moreWorkRemains?: boolean;
  hasRemainingWork?: boolean;
  reason?: string;
  message?: string;
  blockingJob?: {
    id: string;
    type: string;
    status: string;
    lockedBy: string | null;
    lockedAt: string | null;
    lockExpiresAt: string | null;
    stale: boolean;
  };
  recoveredStaleJobs?: Array<{
    id: string;
    type: string;
    status: string;
    lockedBy: string | null;
    lockedAt: string | null;
    lockExpiresAt: string | null;
    stale: boolean;
  }>;
  progress?: {
    currentStep?: string;
    analyzed?: number;
    remaining?: number;
    complete?: boolean;
    completed?: number;
    total?: number;
    percent?: number;
  };
};

function PipelineActionSummary({ result }: { result: PipelineActionResult }) {
  if (result.message) {
    return <p className="max-w-64 text-xs text-slate-500">{result.message}</p>;
  }

  if (
    typeof result.batchesRun === "number" ||
    typeof result.totalJobsRun === "number"
  ) {
    return (
      <p className="max-w-64 text-xs text-slate-500">
        {`Ran ${result.batchesRun ?? 0} ${
          result.batchesRun === 1 ? "batch" : "batches"
        }, processed ${result.totalJobsRun ?? 0} ${
          result.totalJobsRun === 1 ? "item" : "items"
        }.`}
        {result.moreWorkRemains ?? result.hasRemainingWork
          ? " More work remains."
          : null}
      </p>
    );
  }

  const progress = result.progress;
  const details = [
    progress?.currentStep ? `step ${progress.currentStep}` : null,
    typeof progress?.analyzed === "number" ? `analyzed ${progress.analyzed}` : null,
    typeof progress?.remaining === "number" ? `remaining ${progress.remaining}` : null,
    typeof progress?.complete === "boolean" ? `complete ${progress.complete ? "yes" : "no"}` : null
  ].filter(Boolean);

  return (
    <p className="max-w-64 text-xs text-slate-500">
      {typeof result.jobsRun === "number" ? `${result.jobsRun} job(s) ran.` : "Done."}
      {details.length > 0 ? ` ${details.join(" | ")}.` : null}
      {typeof result.remainingReadyJobs === "number"
        ? ` Ready jobs left: ${result.remainingReadyJobs}.`
        : null}
      {result.hasRemainingWork ? " More work remains." : null}
    </p>
  );
}
