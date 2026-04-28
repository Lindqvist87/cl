import type { Metadata } from "next";
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
            <a href="/" className="text-base font-semibold tracking-normal">
              {copy.shell.brand}
            </a>
            <nav className="flex items-center gap-4 text-sm text-slate-600">
              <a href="/corpus" className="hover:text-ink">Corpus</a>
              <a href="/trends" className="hover:text-ink">Trends</a>
              <span>{copy.shell.badge}</span>
            </nav>
          </div>
        </div>
        <main className="mx-auto max-w-6xl px-5 py-6">{children}</main>
      </body>
    </html>
  );
}
