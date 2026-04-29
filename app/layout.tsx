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
        <div className="border-b border-line bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
            <Link href="/" className="text-base font-semibold tracking-normal">
              {copy.shell.brand}
            </Link>
            <nav className="flex items-center gap-4 text-sm text-slate-600">
              <Link href="/corpus" className="hover:text-ink">Corpus</Link>
              <Link href="/trends" className="hover:text-ink">Trends</Link>
              <Link href="/admin/jobs" className="hover:text-ink">Jobs</Link>
              <Link href="/admin/inngest" className="hover:text-ink">Inngest</Link>
              <span>{copy.shell.badge}</span>
            </nav>
          </div>
        </div>
        <main className="mx-auto max-w-6xl px-5 py-6">{children}</main>
      </body>
    </html>
  );
}
