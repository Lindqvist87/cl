"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";

export function PipelineActionButton({
  endpoint,
  payload,
  label,
  runningLabel,
  variant = "secondary"
}: {
  endpoint: string;
  payload?: Record<string, unknown>;
  label: string;
  runningLabel?: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineActionResult | null>(null);

  async function runAction() {
    setIsRunning(true);
    setError(null);
    setResult(null);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {})
    });
    const nextResult = (await response.json().catch(() => ({}))) as PipelineActionResult;

    setIsRunning(false);

    if (!response.ok) {
      setError(nextResult.error ?? "Action failed.");
      return;
    }

    setResult(nextResult);
    router.refresh();
  }

  const className =
    variant === "primary"
      ? "bg-ink text-white"
      : variant === "danger"
        ? "border border-danger bg-white text-danger"
        : "border border-line bg-paper text-ink";

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={runAction}
        disabled={isRunning}
        className={`focus-ring inline-flex min-h-9 items-center justify-center gap-2 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
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
  jobsRun?: number;
  remainingReadyJobs?: number;
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
