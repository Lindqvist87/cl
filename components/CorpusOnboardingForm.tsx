"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileText, Upload, X } from "lucide-react";

type RightsStatus =
  | "PUBLIC_DOMAIN"
  | "OPEN_LICENSE"
  | "LICENSED"
  | "PRIVATE_REFERENCE"
  | "METADATA_ONLY"
  | "UNKNOWN";

type SourceType =
  | "MANUAL"
  | "GUTENBERG"
  | "LITTERATURBANKEN"
  | "SPRAKBANKEN"
  | "DOAB"
  | "PRIVATE";

type BookRow = {
  id: string;
  file: File;
  title: string;
  author: string;
  language: string;
  genre: string;
  source: string;
  sourceUrl: string;
  sourceType: SourceType;
  rightsStatus: RightsStatus;
  licenseType: string;
  benchmarkAllowed: boolean;
};

const RIGHTS_OPTIONS: Array<{ value: RightsStatus; label: string }> = [
  { value: "PUBLIC_DOMAIN", label: "Public domain" },
  { value: "OPEN_LICENSE", label: "Open license" },
  { value: "LICENSED", label: "Licensed" },
  { value: "PRIVATE_REFERENCE", label: "Private reference" },
  { value: "METADATA_ONLY", label: "Metadata only" },
  { value: "UNKNOWN", label: "Unknown" }
];

const SOURCE_OPTIONS: Array<{ value: SourceType; label: string }> = [
  { value: "MANUAL", label: "Manual" },
  { value: "GUTENBERG", label: "Project Gutenberg" },
  { value: "LITTERATURBANKEN", label: "Litteraturbanken" },
  { value: "SPRAKBANKEN", label: "Sprakbanken" },
  { value: "DOAB", label: "DOAB" },
  { value: "PRIVATE", label: "Private" }
];

export function CorpusOnboardingForm() {
  const router = useRouter();
  const [rows, setRows] = useState<BookRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validationError = useMemo(() => {
    const invalidBenchmark = rows.find(
      (row) =>
        row.benchmarkAllowed &&
        (row.rightsStatus === "UNKNOWN" || row.rightsStatus === "METADATA_ONLY")
    );
    if (invalidBenchmark) {
      return `${invalidBenchmark.title || invalidBenchmark.file.name}: benchmarking needs a rights status that allows use.`;
    }
    return null;
  }, [rows]);

  function onFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    setMessage(null);
    setError(null);
    setRows((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        title: titleFromFile(file.name),
        author: "",
        language: "",
        genre: "",
        source: "",
        sourceUrl: "",
        sourceType: guessSourceType(file.name),
        rightsStatus: "PUBLIC_DOMAIN" as RightsStatus,
        licenseType: "",
        benchmarkAllowed: true
      }))
    ]);
    event.target.value = "";
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (rows.length === 0) {
      setError("Upload at least one book.");
      return;
    }

    if (validationError) {
      setError(validationError);
      return;
    }

    const formData = new FormData();
    rows.forEach((row) => formData.append("files", row.file));
    formData.set(
      "books",
      JSON.stringify(
        rows.map(({ file: _file, id: _id, ...metadata }) => metadata)
      )
    );

    setIsSubmitting(true);
    const response = await fetch("/api/corpus/manual", {
      method: "POST",
      body: formData
    });
    const payload = (await response.json()) as {
      imported?: number;
      error?: string;
    };
    setIsSubmitting(false);

    if (!response.ok) {
      setError(payload.error ?? "Corpus onboarding failed.");
      return;
    }

    setRows([]);
    setMessage(`${payload.imported ?? 0} corpus import job(s) created.`);
    router.refresh();
  }

  function updateRow(id: string, patch: Partial<BookRow>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  return (
    <form onSubmit={onSubmit} className="border border-line bg-white shadow-panel">
      <div className="border-b border-line p-4">
        <label className="focus-ring inline-flex min-h-10 cursor-pointer items-center gap-2 bg-ink px-4 py-2 text-sm font-semibold text-white">
          <Upload size={18} aria-hidden="true" />
          Upload Books
          <input
            type="file"
            multiple
            accept=".txt,.md,.xml,.tei,.epub,.docx,text/plain,text/markdown,application/xml,text/xml,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            onChange={onFilesSelected}
          />
        </label>
        <span className="ml-3 text-sm text-slate-600">
          TXT, Markdown, XML, EPUB, or DOCX
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">
          No files selected.
        </div>
      ) : (
        <div className="divide-y divide-line">
          {rows.map((row, index) => (
            <div key={row.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <FileText size={18} className="mt-1 shrink-0 text-accent" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Book {index + 1}
                    </div>
                    <div className="truncate text-sm font-semibold">{row.file.name}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="focus-ring inline-flex h-9 w-9 items-center justify-center border border-line text-slate-600 hover:bg-paper"
                  aria-label={`Remove ${row.file.name}`}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <TextInput label="Title" value={row.title} required onChange={(title) => updateRow(row.id, { title })} />
                <TextInput label="Author" value={row.author} onChange={(author) => updateRow(row.id, { author })} />
                <TextInput label="Language" value={row.language} onChange={(language) => updateRow(row.id, { language })} />
                <TextInput label="Genre" value={row.genre} onChange={(genre) => updateRow(row.id, { genre })} />
                <TextInput label="Source" value={row.source} onChange={(source) => updateRow(row.id, { source })} />
                <TextInput label="Source URL" value={row.sourceUrl} onChange={(sourceUrl) => updateRow(row.id, { sourceUrl })} />
                <SelectInput
                  label="Source type"
                  value={row.sourceType}
                  options={SOURCE_OPTIONS}
                  onChange={(sourceType) => updateRow(row.id, { sourceType })}
                />
                <SelectInput
                  label="Rights"
                  value={row.rightsStatus}
                  options={RIGHTS_OPTIONS}
                  onChange={(rightsStatus) =>
                    updateRow(row.id, {
                      rightsStatus,
                      benchmarkAllowed:
                        rightsStatus === "UNKNOWN" || rightsStatus === "METADATA_ONLY"
                          ? false
                          : row.benchmarkAllowed
                    })
                  }
                />
                <TextInput label="License" value={row.licenseType} onChange={(licenseType) => updateRow(row.id, { licenseType })} />
                <label className="flex min-h-10 items-center gap-2 border border-line bg-paper px-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={row.benchmarkAllowed}
                    disabled={row.rightsStatus === "UNKNOWN" || row.rightsStatus === "METADATA_ONLY"}
                    onChange={(event) =>
                      updateRow(row.id, { benchmarkAllowed: event.target.checked })
                    }
                    className="h-4 w-4"
                  />
                  Benchmark allowed
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-line p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {validationError || error ? (
            <p className="flex items-center gap-2 text-sm text-danger">
              <AlertTriangle size={16} aria-hidden="true" />
              {error ?? validationError}
            </p>
          ) : message ? (
            <p className="text-sm text-slate-700">{message}</p>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={isSubmitting || rows.length === 0 || Boolean(validationError)}
          className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          <Upload size={18} aria-hidden="true" />
          {isSubmitting ? "Creating Jobs..." : "Create Import Jobs"}
        </button>
      </div>
    </form>
  );
}

function TextInput({
  label,
  value,
  required,
  onChange
}: {
  label: string;
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <input
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="focus-ring mt-1 min-h-10 w-full border border-line bg-paper px-3 text-sm"
      />
    </label>
  );
}

function SelectInput<TValue extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: TValue;
  options: Array<{ value: TValue; label: string }>;
  onChange: (value: TValue) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as TValue)}
        className="focus-ring mt-1 min-h-10 w-full border border-line bg-paper px-3 text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function titleFromFile(fileName: string) {
  return fileName
    .replace(/\.(txt|md|xml|tei|epub|docx)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function guessSourceType(fileName: string): SourceType {
  const lower = fileName.toLowerCase();
  if (lower.includes("gutenberg")) return "GUTENBERG";
  if (lower.includes("litteraturbanken")) return "LITTERATURBANKEN";
  if (lower.includes("sprakbanken")) {
    return "SPRAKBANKEN";
  }
  return "MANUAL";
}
