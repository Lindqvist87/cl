import type { Metadata } from "next";
import Link from "next/link";
import copy from "@/content/app-copy.json";
import "./globals.css";

export const metadata: Metadata = {
  title: copy.metadata.title,
  description: copy.metadata.description
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-ink antialiased">
        <div className="border-b border-line bg-white/90">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/" className="group inline-flex items-center gap-3 text-ink">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-sm font-semibold text-accent">
                MI
              </span>
              <span>
                <span className="block text-base font-semibold tracking-normal">
                  {copy.shell.brand}
                </span>
                <span className="block text-xs font-medium text-muted">
                  Editorial workspace
                </span>
              </span>
            </Link>
            <nav className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-paper-alt p-1 text-sm text-muted">
              <Link href="/" className="rounded-lg px-3 py-2 font-semibold hover:bg-white hover:text-ink">Manuscripts</Link>
              <Link href="/corpus" className="rounded-lg px-3 py-2 font-semibold hover:bg-white hover:text-ink">Reference library</Link>
              <Link href="/trends" className="rounded-lg px-3 py-2 font-semibold hover:bg-white hover:text-ink">Market signals</Link>
              <span className="ml-1 rounded-lg border border-line bg-white px-2 py-2 text-xs font-semibold text-muted">
                {copy.shell.badge}
              </span>
              <details className="relative">
                <summary className="cursor-pointer rounded-lg px-3 py-2 font-semibold hover:bg-white hover:text-ink">
                  Admin tools
                </summary>
                <div className="absolute right-0 z-20 mt-2 grid min-w-48 gap-1 rounded-xl border border-line bg-white p-2 shadow-panel">
                  <Link href="/admin/corpus/onboarding" className="rounded-lg px-3 py-2 font-semibold hover:bg-paper-alt hover:text-ink">Corpus intake</Link>
                  <Link href="/admin/jobs" className="rounded-lg px-3 py-2 font-semibold hover:bg-paper-alt hover:text-ink">Analysis jobs</Link>
                  <Link href="/admin/inngest" className="rounded-lg px-3 py-2 font-semibold hover:bg-paper-alt hover:text-ink">Diagnostics</Link>
                </div>
              </details>
            </nav>
          </div>
        </div>
        <main className="mx-auto max-w-6xl px-5 py-10">{children}</main>
      </body>
    </html>
  );
}
