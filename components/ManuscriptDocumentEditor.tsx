"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  Save
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SaveStatus = "saved" | "dirty" | "saving" | "error";

type SaveResponse = {
  error?: string;
  wordCount?: number;
  updatedAt?: string;
};

type ManuscriptDocumentEditorProps = {
  manuscriptId: string;
  initialText: string;
  initialWordCount: number;
  initialUpdatedAt: string;
  sourceFileName: string;
  downloadHref: string;
};

const AUTOSAVE_DELAY_MS = 1200;

export function ManuscriptDocumentEditor({
  manuscriptId,
  initialText,
  initialWordCount,
  initialUpdatedAt,
  sourceFileName,
  downloadHref
}: ManuscriptDocumentEditorProps) {
  const [text, setText] = useState(initialText);
  const [wordCount, setWordCount] = useState(initialWordCount);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initialUpdatedAt);

  const textRef = useRef(initialText);
  const lastSavedTextRef = useRef(initialText);
  const isSavingRef = useRef(false);
  const queuedTextRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  const saveDocument = useCallback(
    async (nextText: string): Promise<boolean> => {
      if (nextText === lastSavedTextRef.current) {
        setError(null);
        if (!isSavingRef.current) {
          setStatus("saved");
        }
        return true;
      }

      if (isSavingRef.current) {
        queuedTextRef.current = nextText;
        setStatus("saving");
        return false;
      }

      isSavingRef.current = true;
      setStatus("saving");
      setError(null);

      try {
        const response = await fetch(`/api/manuscripts/${manuscriptId}/document`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ text: nextText })
        });
        const payload = (await response.json().catch(() => ({}))) as SaveResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "Kunde inte spara dokumentet.");
        }

        lastSavedTextRef.current = nextText;
        if (typeof payload.wordCount === "number") {
          setWordCount(payload.wordCount);
        }
        if (payload.updatedAt) {
          setLastSavedAt(payload.updatedAt);
        }
      } catch (saveError) {
        queuedTextRef.current = null;
        const message =
          saveError instanceof Error ? saveError.message : "Kunde inte spara dokumentet.";
        setError(message);
        setStatus("error");
        return false;
      } finally {
        isSavingRef.current = false;
      }

      const queuedText = queuedTextRef.current;
      queuedTextRef.current = null;

      if (queuedText !== null && queuedText !== lastSavedTextRef.current) {
        void saveDocument(queuedText);
        return true;
      }

      setStatus(textRef.current === lastSavedTextRef.current ? "saved" : "dirty");
      return true;
    },
    [manuscriptId]
  );

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    if (text === lastSavedTextRef.current) {
      if (!isSavingRef.current) {
        setStatus("saved");
      }
      return;
    }

    if (!isSavingRef.current) {
      setStatus("dirty");
    }

    timerRef.current = setTimeout(() => {
      void saveDocument(textRef.current);
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [text, saveDocument]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (textRef.current !== lastSavedTextRef.current || isSavingRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const statusMeta = useMemo(() => getStatusMeta(status), [status]);
  const formattedSavedAt = formatSavedAt(lastSavedAt);

  async function handleSaveNow() {
    await saveDocument(textRef.current);
  }

  async function handleDownload() {
    const saved = await saveDocument(textRef.current);

    if (saved || textRef.current === lastSavedTextRef.current) {
      window.location.assign(downloadHref);
    }
  }

  return (
    <section className="border border-line bg-white shadow-panel">
      <div className="flex flex-col gap-4 border-b border-line px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Dokument
          </h2>
          <p className="mt-1 truncate text-sm text-muted">{sourceFileName}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-live="polite"
            className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm font-semibold ${statusMeta.className}`}
          >
            <statusMeta.Icon size={16} className={status === "saving" ? "animate-spin" : ""} aria-hidden="true" />
            {statusMeta.label}
          </span>
          <span className="inline-flex min-h-9 items-center rounded-full border border-line bg-paper-alt px-3 text-sm font-semibold text-slate-600">
            {wordCount.toLocaleString("sv-SE")} ord
          </span>
          {formattedSavedAt ? (
            <span
              suppressHydrationWarning
              className="inline-flex min-h-9 items-center rounded-full border border-line bg-paper-alt px-3 text-sm font-semibold text-slate-600"
            >
              Senast {formattedSavedAt}
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleSaveNow}
            disabled={status === "saving"}
            className="secondary-button min-h-9 px-3"
          >
            <Save size={16} aria-hidden="true" />
            Spara nu
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={status === "saving"}
            className="secondary-button min-h-9 px-3"
          >
            <Download size={16} aria-hidden="true" />
            Ladda ner DOCX
          </button>
        </div>
      </div>

      {error ? (
        <div className="border-b border-danger/20 bg-red-50 px-5 py-3 text-sm font-semibold text-danger" role="alert">
          {error}
        </div>
      ) : null}

      <div className="bg-[#FAFAF7] px-3 py-4 sm:px-6 sm:py-7">
        <article className="mx-auto min-h-[560px] max-w-3xl border border-line bg-white px-5 py-7 shadow-[0_18px_42px_rgba(23,23,23,0.08)] sm:px-10 sm:py-11">
          <textarea
            aria-label="Dokumenttext"
            spellCheck
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => {
              if (textRef.current !== lastSavedTextRef.current) {
                void saveDocument(textRef.current);
              }
            }}
            className="block min-h-[500px] w-full resize-y border-0 bg-transparent p-0 text-base leading-8 text-slate-800 outline-none placeholder:text-slate-400 focus:ring-0"
            placeholder="Börja skriva här..."
          />
        </article>
      </div>
    </section>
  );
}

function getStatusMeta(status: SaveStatus) {
  if (status === "saved") {
    return {
      Icon: CheckCircle2,
      label: "Sparat",
      className: "border-success/20 bg-green-50 text-success"
    };
  }

  if (status === "saving") {
    return {
      Icon: Loader2,
      label: "Sparar...",
      className: "border-accent/20 bg-accent/10 text-accent"
    };
  }

  if (status === "error") {
    return {
      Icon: AlertCircle,
      label: "Kunde inte spara",
      className: "border-danger/20 bg-red-50 text-danger"
    };
  }

  return {
    Icon: Clock3,
    label: "Osparade ändringar",
    className: "border-warn/20 bg-warn/10 text-warn"
  };
}

function formatSavedAt(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleTimeString("sv-SE", {
    hour: "2-digit",
    minute: "2-digit"
  });
}
