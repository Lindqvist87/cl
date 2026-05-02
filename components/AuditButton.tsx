"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlayCircle } from "lucide-react";

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

    const response = await fetch(`/api/manuscripts/${manuscriptId}/run-pipeline`, {
      method: "POST"
    });
    const payload = (await response.json()) as { error?: string };

    setIsRunning(false);

    if (!response.ok) {
      setError(payload.error ?? "Audit failed.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={runAudit}
        disabled={disabled || isRunning}
        className="primary-button"
      >
        <PlayCircle size={18} aria-hidden="true" />
        {isRunning ? "Starting..." : "Start analysis"}
      </button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
