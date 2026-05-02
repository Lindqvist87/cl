"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2 } from "lucide-react";

export function RewriteChapterButton({ manuscriptId }: { manuscriptId: string }) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rewrite() {
    setIsRunning(true);
    setError(null);

    const response = await fetch(
      `/api/manuscripts/${manuscriptId}/rewrite-chapter-1`,
      { method: "POST" }
    );
    const payload = (await response.json()) as { error?: string };

    setIsRunning(false);

    if (!response.ok) {
      setError(payload.error ?? "Rewrite failed.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={rewrite}
        disabled={isRunning}
        className="secondary-button"
      >
        <Wand2 size={18} aria-hidden="true" />
        {isRunning ? "Rewriting..." : "Rewrite Chapter 1"}
      </button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
