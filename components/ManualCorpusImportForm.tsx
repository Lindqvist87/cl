"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

export function ManualCorpusImportForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formRef.current) return;

    setIsSubmitting(true);
    setError(null);

    const response = await fetch("/api/corpus/manual", {
      method: "POST",
      body: new FormData(formRef.current)
    });
    const payload = (await response.json()) as { error?: string };

    setIsSubmitting(false);

    if (!response.ok) {
      setError(payload.error ?? "Corpus import failed.");
      return;
    }

    formRef.current.reset();
    router.refresh();
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="border border-line bg-white p-4 shadow-panel">
      <div className="grid gap-3 md:grid-cols-2">
        <input name="title" required placeholder="Title" className="focus-ring min-h-10 border border-line bg-paper px-3 text-sm" />
        <input name="author" placeholder="Author" className="focus-ring min-h-10 border border-line bg-paper px-3 text-sm" />
        <input name="language" placeholder="Language" className="focus-ring min-h-10 border border-line bg-paper px-3 text-sm" />
        <input name="genre" placeholder="Genre" className="focus-ring min-h-10 border border-line bg-paper px-3 text-sm" />
        <input name="publicationYear" type="number" placeholder="Publication year" className="focus-ring min-h-10 border border-line bg-paper px-3 text-sm" />
        <input name="sourceUrl" placeholder="Source URL" className="focus-ring min-h-10 border border-line bg-paper px-3 text-sm" />
        <select name="sourceType" className="focus-ring min-h-10 border border-line bg-paper px-3 text-sm" defaultValue="MANUAL">
          <option value="MANUAL">Manual</option>
          <option value="GUTENBERG">Project Gutenberg</option>
          <option value="LITTERATURBANKEN">Litteraturbanken</option>
          <option value="SPRAKBANKEN">Sprakbanken</option>
          <option value="DOAB">DOAB</option>
          <option value="PRIVATE">Private reference</option>
        </select>
        <select name="rightsStatus" required className="focus-ring min-h-10 border border-line bg-paper px-3 text-sm" defaultValue="">
          <option value="" disabled>Rights status</option>
          <option value="PUBLIC_DOMAIN">Public domain</option>
          <option value="OPEN_LICENSE">Open license</option>
          <option value="LICENSED">Licensed</option>
          <option value="PRIVATE_REFERENCE">Private reference</option>
          <option value="METADATA_ONLY">Metadata only</option>
          <option value="UNKNOWN">Unknown</option>
        </select>
        <input name="licenseType" placeholder="License type" className="focus-ring min-h-10 border border-line bg-paper px-3 text-sm" />
        <input name="file" type="file" accept=".txt,.docx,.epub,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="focus-ring min-h-10 border border-line bg-paper px-3 py-2 text-sm" />
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="corpusBenchmarking" className="h-4 w-4" defaultChecked />
        Allow corpus benchmarking
      </label>
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" disabled={isSubmitting} className="focus-ring inline-flex min-h-10 items-center gap-2 bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          <Upload size={18} aria-hidden="true" />
          {isSubmitting ? "Importing..." : "Import Corpus Book"}
        </button>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </form>
  );
}
