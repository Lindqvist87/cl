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

  async function runAction() {
    setIsRunning(true);
    setError(null);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {})
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };

    setIsRunning(false);

    if (!response.ok) {
      setError(result.error ?? "Action failed.");
      return;
    }

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
    </div>
  );
}
