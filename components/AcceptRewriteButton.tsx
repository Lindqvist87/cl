"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

export function AcceptRewriteButton({
  manuscriptId,
  chapterId,
  disabled
}: {
  manuscriptId: string;
  chapterId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setIsSaving(true);
    setError(null);

    const response = await fetch(
      `/api/manuscripts/${manuscriptId}/chapters/${chapterId}/accept-rewrite`,
      { method: "POST" }
    );
    const payload = (await response.json()) as { error?: string };

    setIsSaving(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not accept rewrite.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={disabled || isSaving}
        onClick={accept}
        className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        <Check size={16} aria-hidden="true" />
        {isSaving ? "Saving..." : "Accept Version"}
      </button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
