"use client";

import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Loader2,
  Plus,
  Save,
  TriangleAlert
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  joinDocumentPages,
  splitDocumentIntoPages,
  type DocumentPage
} from "@/lib/document/pageMarkers";
import {
  detectDocumentChapters,
  type DocumentChapterDetection,
  type DocumentChapterDetectionMethod,
  type DocumentChapterDetectionWarning
} from "@/lib/document/chapterMarkers";

type SaveStatus = "saved" | "dirty" | "saving" | "error";
type DocumentViewMode = "pages" | "chapters";

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
  const initialPages = useMemo(() => splitDocumentIntoPages(initialText), [initialText]);
  const initialSerializedText = useMemo(
    () => joinDocumentPages(initialPages),
    [initialPages]
  );
  const [pages, setPages] = useState<DocumentPage[]>(initialPages);
  const [text, setText] = useState(initialSerializedText);
  const [wordCount, setWordCount] = useState(initialWordCount);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initialUpdatedAt);
  const [viewMode, setViewMode] = useState<DocumentViewMode>("pages");

  const textRef = useRef(initialSerializedText);
  const lastSavedTextRef = useRef(initialSerializedText);
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
  const chapterDetection = useMemo(
    () => detectDocumentChapters(pages),
    [pages]
  );
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

  function updatePageText(pageIndex: number, nextText: string) {
    setPages((currentPages) => {
      const nextPages = currentPages.map((page, index) =>
        index === pageIndex ? { ...page, text: nextText } : page
      );
      setText(joinDocumentPages(nextPages));
      return nextPages;
    });
  }

  function addPage() {
    setPages((currentPages) => {
      const nextPages = [
        ...currentPages,
        {
          pageNumber: currentPages.length + 1,
          text: ""
        }
      ];
      setText(joinDocumentPages(nextPages));
      return nextPages;
    });
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
            <statusMeta.Icon
              size={16}
              className={status === "saving" ? "animate-spin" : ""}
              aria-hidden="true"
            />
            {statusMeta.label}
          </span>
          <span className="inline-flex min-h-9 items-center rounded-full border border-line bg-paper-alt px-3 text-sm font-semibold text-slate-600">
            {wordCount.toLocaleString("sv-SE")} ord
          </span>
          <span className="inline-flex min-h-9 items-center rounded-full border border-line bg-paper-alt px-3 text-sm font-semibold text-slate-600">
            {pages.length.toLocaleString("sv-SE")} sidor
          </span>
          <div
            className="inline-flex min-h-9 items-center rounded-lg border border-line bg-paper-alt p-1"
            aria-label="Visningsläge"
          >
            <ViewModeButton
              active={viewMode === "pages"}
              icon={<FileText size={15} aria-hidden="true" />}
              label={`${pages.length.toLocaleString("sv-SE")} sidor`}
              onClick={() => setViewMode("pages")}
            />
            <ViewModeButton
              active={viewMode === "chapters"}
              icon={<BookOpen size={15} aria-hidden="true" />}
              label={
                chapterDetection.canDetermineChapters
                  ? `${chapterDetection.chapters.length.toLocaleString("sv-SE")} kapitel`
                  : "Kapitel ?"
              }
              onClick={() => setViewMode("chapters")}
            />
          </div>
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
            onClick={addPage}
            className="secondary-button min-h-9 px-3"
          >
            <Plus size={16} aria-hidden="true" />
            Ny sida
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
        <div
          className="border-b border-danger/20 bg-red-50 px-5 py-3 text-sm font-semibold text-danger"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {viewMode === "chapters" && chapterDetection.warning ? (
        <ChapterDetectionWarning warning={chapterDetection.warning} />
      ) : null}

      {viewMode === "chapters" ? (
        <ChapterOverview detection={chapterDetection} />
      ) : (
      <div className="space-y-8 bg-[#FAFAF7] px-3 py-4 sm:px-6 sm:py-7">
        {pages.map((page, index) => (
          <article
            key={`${page.pageNumber}-${index}`}
            className="mx-auto max-w-3xl border border-line bg-white shadow-[0_18px_42px_rgba(23,23,23,0.08)]"
          >
            <div className="flex items-center justify-between gap-4 border-b border-line bg-paper-alt px-5 py-3 sm:px-10">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                Sida {page.pageNumber}
              </h3>
              <span className="text-xs font-semibold text-slate-500">
                {page.text.trim()
                  ? `${page.text.length.toLocaleString("sv-SE")} tecken`
                  : "Tom sida"}
              </span>
            </div>
            <div className="min-h-[560px] px-5 py-7 sm:px-10 sm:py-11">
              <textarea
                aria-label={`Sida ${page.pageNumber} dokumenttext`}
                spellCheck
                value={page.text}
                onChange={(event) => updatePageText(index, event.target.value)}
                onBlur={() => {
                  if (textRef.current !== lastSavedTextRef.current) {
                    void saveDocument(textRef.current);
                  }
                }}
                className="block min-h-[500px] w-full resize-y border-0 bg-transparent p-0 text-base leading-8 text-slate-800 outline-none placeholder:text-slate-400 focus:ring-0"
                placeholder="Börja skriva här..."
              />
            </div>
          </article>
        ))}
      </div>
      )}
    </section>
  );
}

function ViewModeButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex min-h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition ${
        active
          ? "bg-white text-ink shadow-sm"
          : "text-slate-600 hover:bg-white/70 hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ChapterDetectionWarning({
  warning
}: {
  warning: DocumentChapterDetectionWarning;
}) {
  return (
    <div
      className="border-b border-warn/30 bg-amber-50 px-5 py-4 text-sm text-amber-950"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert
          size={18}
          className="mt-0.5 shrink-0 text-warn"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h3 className="font-semibold">{warning.title}</h3>
          <p className="mt-1 leading-6">{warning.message}</p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 leading-6">
            {warning.instructions.map((instruction) => (
              <li key={instruction}>{instruction}</li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function ChapterOverview({
  detection
}: {
  detection: DocumentChapterDetection;
}) {
  if (!detection.canDetermineChapters) {
    return (
      <div className="bg-[#FAFAF7] px-3 py-8 sm:px-6">
        <div className="mx-auto max-w-3xl border border-line bg-white p-5 text-sm text-slate-600 shadow-panel">
          Ingen säker kapitelöversikt finns för dokumentet ännu.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#FAFAF7] px-3 py-5 sm:px-6 sm:py-7">
      <div className="mx-auto max-w-3xl space-y-4">
        {detection.chapters.map((chapter) => (
          <article
            key={`${chapter.order}-${chapter.startPageNumber}-${chapter.heading}`}
            className="border border-line bg-white p-4 shadow-panel"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Kapitel {chapter.order}
                </div>
                <h3 className="mt-1 text-lg font-semibold tracking-normal text-ink">
                  {chapter.title}
                </h3>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                <span className="inline-flex min-h-7 items-center border border-line bg-paper-alt px-2">
                  {chapterPageLabel(chapter.startPageNumber, chapter.endPageNumber)}
                </span>
                <span className="inline-flex min-h-7 items-center border border-line bg-paper-alt px-2">
                  {chapter.wordCount.toLocaleString("sv-SE")} ord
                </span>
                <span className="inline-flex min-h-7 items-center border border-line bg-paper-alt px-2">
                  {chapterMethodLabel(chapter.method)}
                </span>
              </div>
            </div>
            {chapter.preview ? (
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-700">
                {chapter.preview}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function chapterPageLabel(startPage: number, endPage: number) {
  return startPage === endPage
    ? `Sida ${startPage.toLocaleString("sv-SE")}`
    : `Sidor ${startPage.toLocaleString("sv-SE")}-${endPage.toLocaleString("sv-SE")}`;
}

function chapterMethodLabel(method: DocumentChapterDetectionMethod) {
  const labels: Record<DocumentChapterDetectionMethod, string> = {
    explicit_heading: "Kapitelrubrik",
    marked_heading: "Markerad rubrik",
    numeric_sequence: "Nummerserie",
    page_top_heading: "Sidrubrik"
  };

  return labels[method];
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
