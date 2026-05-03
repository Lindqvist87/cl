"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, PlayCircle } from "lucide-react";
import { PIPELINE_DIAGNOSTICS_REFRESH_EVENT } from "@/components/pipelineEvents";

export function AuditButton({
  manuscriptId,
  disabled
}: {
  manuscriptId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAudit() {
    setIsRunning(true);
    setError(null);
    dispatchProgressRefresh("starting", true);

    let response: Response;
    let payload: { error?: string };

    try {
      response = await fetch(`/api/manuscripts/${manuscriptId}/run-pipeline`, {
        method: "POST"
      });
      payload = (await response.json().catch(() => ({}))) as { error?: string };
    } catch (error) {
      setIsRunning(false);
      setError(
        error instanceof Error ? error.message : "Analysen kunde inte startas."
      );
      dispatchProgressRefresh("failed", false);
      return;
    }

    setIsRunning(false);

    if (!response.ok) {
      setError(payload.error ?? "Analysen kunde inte startas.");
      dispatchProgressRefresh("failed", false);
      return;
    }

    dispatchProgressRefresh("running", false);
    router.refresh();
  }

  function dispatchProgressRefresh(
    phase: "starting" | "running" | "failed",
    autoRunnerActive: boolean
  ) {
    window.dispatchEvent(
      new CustomEvent(PIPELINE_DIAGNOSTICS_REFRESH_EVENT, {
        detail: {
          manuscriptId,
          autoRunnerActive,
          phase
        }
      })
    );
  }

  const isDisabled = disabled || isRunning;
  const Icon = isDisabled ? LoaderCircle : PlayCircle;
  const label = isRunning
    ? "Startar..."
    : disabled
      ? "Analysen pågår"
      : "Starta analys";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={runAudit}
        disabled={isDisabled}
        className="primary-button"
      >
        <Icon
          size={18}
          aria-hidden="true"
          className={isDisabled ? "animate-spin" : undefined}
        />
        {label}
      </button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
