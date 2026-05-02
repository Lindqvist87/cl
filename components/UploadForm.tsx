"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, Upload } from "lucide-react";
import copy from "@/content/app-copy.json";

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  function selectFile(fileName: string | null) {
    setSelectedFileName(fileName);
    setError(null);
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    selectFile(event.currentTarget.files?.[0]?.name ?? null);
  }

  function onDragOver(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (!isUploading) {
      setIsDragging(true);
    }
  }

  function onDragLeave(event: React.DragEvent<HTMLLabelElement>) {
    const nextTarget = event.relatedTarget;

    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setIsDragging(false);
  }

  function onDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files?.[0];

    if (!file || !inputRef.current) {
      return;
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    inputRef.current.files = dataTransfer.files;
    selectFile(file.name);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];

    if (!file) {
      setError(copy.upload.emptyFileError);
      return;
    }

    const formData = new FormData(event.currentTarget);
    formData.set("file", file);
    setIsUploading(true);
    setError(null);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    const payload = (await response.json()) as {
      manuscriptId?: string;
      error?: string;
    };

    setIsUploading(false);

    if (!response.ok || !payload.manuscriptId) {
      setError(payload.error ?? copy.upload.failedError);
      return;
    }

    router.push(`/manuscripts/${payload.manuscriptId}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="active-card overflow-hidden p-5 sm:p-7">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-accent">
          Ladda upp ditt manus. Vi hjälper dig förstå vad som behöver göras.
        </p>
      </div>

      <label
        className={`mt-5 flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-5 py-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-paper sm:min-h-[280px] sm:py-10 ${
          isDragging
            ? "border-accent bg-white shadow-[0_0_0_6px_rgba(232,93,158,0.08)]"
            : "border-accent/35 bg-paper-alt hover:border-accent/70 hover:bg-white"
        }`}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-full border border-accent/15 bg-white text-accent shadow-panel">
          <FileText size={28} aria-hidden="true" />
        </span>
        <span className="mt-6 text-2xl font-semibold tracking-normal text-ink">
          Dra in din fil här
        </span>
        <span className="mt-3 text-sm text-muted">eller</span>
        <span
          className={
            selectedFileName
              ? "mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line bg-white px-5 text-sm font-semibold text-ink shadow-panel hover:border-accent/40 hover:text-accent"
              : "primary-button mt-4 min-h-11 px-5"
          }
        >
          <Upload size={16} aria-hidden="true" />
          {selectedFileName ? "Byt fil" : "Välj fil"}
        </span>
        <span className="mt-5 max-w-sm text-sm leading-6 text-muted">
          DOCX stöds först. EPUB och PDF kan läggas till senare.
        </span>
        {selectedFileName ? (
          <span className="mt-5 inline-flex max-w-full items-center gap-2 rounded-full border border-accent/20 bg-white px-4 py-2 text-sm font-semibold text-ink">
            <CheckCircle2 size={16} className="shrink-0 text-accent" aria-hidden="true" />
            <span className="truncate">{selectedFileName}</span>
          </span>
        ) : null}
        <input
          ref={inputRef}
          name="file"
          type="file"
          accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          onChange={onFileChange}
        />
      </label>

      <details className="mt-4 rounded-lg border border-line bg-paper-alt/60">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink hover:text-accent">
          Lägg till sammanhang (valfritt)
        </summary>
        <div className="grid gap-3 border-t border-line p-4 lg:grid-cols-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Författare
            </span>
            <input
              name="authorName"
              placeholder="Namn"
              className="focus-ring mt-1 min-h-10 w-full border border-line bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Genre
            </span>
            <input
              name="targetGenre"
              placeholder="Ex. roman"
              className="focus-ring mt-1 min-h-10 w-full border border-line bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Läsare
            </span>
            <input
              name="targetAudience"
              placeholder="Ex. vuxen"
              className="focus-ring mt-1 min-h-10 w-full border border-line bg-white px-3 py-2 text-sm"
            />
          </label>
        </div>
      </details>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-muted">
          Du kan starta med bara filen och lägga till mer senare.
        </p>
        <button
          type="submit"
          disabled={isUploading}
          className={`${selectedFileName ? "primary-button" : "secondary-button"} min-h-12 sm:min-w-52`}
        >
          <Upload size={18} aria-hidden="true" />
          {isUploading ? copy.upload.busyLabel : copy.upload.idleLabel}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </form>
  );
}
