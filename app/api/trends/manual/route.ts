import { NextResponse } from "next/server";
import { importManualTrendSignal } from "@/lib/trends/manualTrendImport";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const source = stringField(formData, "source");

  if (!source) {
    return NextResponse.json({ error: "Source is required." }, { status: 400 });
  }

  try {
    const signal = await importManualTrendSignal({
      source,
      title: stringField(formData, "title"),
      author: stringField(formData, "author"),
      genre: stringField(formData, "genre"),
      category: stringField(formData, "category"),
      rank: numberField(formData, "rank"),
      listName: stringField(formData, "listName"),
      signalDate: dateField(formData, "signalDate"),
      description: stringField(formData, "description"),
      blurb: stringField(formData, "blurb"),
      reviewSnippet: stringField(formData, "reviewSnippet"),
      externalUrl: stringField(formData, "externalUrl")
    });

    return NextResponse.json({ signalId: signal.id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Trend signal import failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function stringField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(formData: FormData, name: string) {
  const value = stringField(formData, name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateField(formData: FormData, name: string) {
  const value = stringField(formData, name);
  return value ? new Date(value) : undefined;
}
