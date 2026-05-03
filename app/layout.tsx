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
  const showAdminNav = process.env.NODE_ENV !== "production";

  return (
    <html lang="sv">
      <body className="min-h-screen bg-paper text-ink antialiased">
        <div className="border-b border-line bg-white/92 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
            <Link
              href="/"
              className="text-base font-semibold tracking-normal text-ink"
            >
              {copy.shell.brand}
            </Link>
            <nav className="hidden items-center gap-1 text-sm font-semibold text-muted sm:flex">
              <Link
                href="/#manus"
                className="rounded-md px-3 py-2 hover:bg-paper hover:text-ink"
              >
                Mina manus
              </Link>
              <Link
                href="/#nytt-manus"
                className="rounded-md px-3 py-2 hover:bg-paper hover:text-ink"
              >
                Nytt manus
              </Link>
              <Link
                href="/corpus"
                className="rounded-md px-3 py-2 hover:bg-paper hover:text-ink"
              >
                Referensbibliotek
              </Link>
              {showAdminNav ? (
                <details className="relative">
                  <summary className="cursor-pointer list-none rounded-md px-3 py-2 hover:bg-paper hover:text-ink">
                    Admin/dev
                  </summary>
                  <div className="absolute right-0 z-20 mt-2 grid w-56 gap-1 rounded-lg border border-line bg-white p-2 text-sm shadow-panel">
                    <Link href="/admin/corpus" className="rounded-md px-3 py-2 hover:bg-paper">
                      Corpusadmin
                    </Link>
                    <Link href="/admin/corpus/onboarding" className="rounded-md px-3 py-2 hover:bg-paper">
                      Onboarding
                    </Link>
                    <Link href="/trends" className="rounded-md px-3 py-2 hover:bg-paper">
                      Trends
                    </Link>
                    <Link href="/admin/jobs" className="rounded-md px-3 py-2 hover:bg-paper">
                      Jobs
                    </Link>
                    <Link href="/admin/inngest" className="rounded-md px-3 py-2 hover:bg-paper">
                      Inngest
                    </Link>
                  </div>
                </details>
              ) : null}
            </nav>
            <Link href="/#nytt-manus" className="primary-button min-h-9 px-3 sm:hidden">
              Nytt manus
            </Link>
          </div>
        </div>
        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
      </body>
    </html>
  );
}
