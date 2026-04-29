import Link from "next/link";
import { PipelineActionButton } from "@/components/PipelineActionButton";
import { PIPELINE_JOB_STATUS } from "@/lib/pipeline/jobRules";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const FILTERS = [
  "inngest-managed",
  "ready",
  "blocked",
  "locked",
  "stale-lock",
  "failed"
] as const;

export default async function AdminJobsPage({
  searchParams
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const activeFilter = FILTERS.includes(filter as (typeof FILTERS)[number])
    ? filter
    : "ready";
  const now = new Date();
  const jobs = await prisma.pipelineJob.findMany({
    where: whereForFilter(activeFilter, now),
    orderBy: [{ createdAt: "desc" }],
    take: 100,
    include: {
      manuscript: { select: { id: true, title: true } }
    }
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Pipeline Jobs</h1>
        <p className="mt-1 text-sm text-slate-600">
          Durable job state remains in Postgres; Inngest only kicks and resumes it.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Link
            key={item}
            href={`/admin/jobs?filter=${item}`}
            className={`focus-ring border px-3 py-2 text-sm font-semibold ${
              item === activeFilter
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-ink"
            }`}
          >
            {formatStatus(item)}
          </Link>
        ))}
      </div>

      <section className="border border-line bg-white shadow-panel">
        <div className="grid gap-2 border-b border-line px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid-cols-[1.2fr_1fr_120px_220px]">
          <div>Job</div>
          <div>Manuscript</div>
          <div>Status</div>
          <div>Actions</div>
        </div>
        {jobs.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            No jobs match this filter.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="grid gap-3 px-4 py-4 text-sm md:grid-cols-[1.2fr_1fr_120px_220px]"
              >
                <div>
                  <div className="font-semibold">{job.type}</div>
                  <div className="mt-1 break-all text-xs text-slate-500">
                    {job.id}
                  </div>
                  {job.error ? (
                    <div className="mt-2 text-xs text-danger">{job.error}</div>
                  ) : null}
                </div>
                <div>
                  {job.manuscript ? (
                    <Link
                      href={`/manuscripts/${job.manuscript.id}`}
                      className="text-accent hover:underline"
                    >
                      {job.manuscript.title}
                    </Link>
                  ) : (
                    <span className="text-slate-500">None</span>
                  )}
                  {job.chapterId ? (
                    <div className="mt-1 break-all text-xs text-slate-500">
                      Chapter {job.chapterId}
                    </div>
                  ) : null}
                </div>
                <div>
                  <div className="font-semibold">{formatStatus(job.status)}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {job.attempts}/{job.maxAttempts}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <PipelineActionButton
                    endpoint="/api/jobs/retry"
                    payload={{ jobId: job.id }}
                    label="Retry"
                    runningLabel="Retrying..."
                  />
                  <PipelineActionButton
                    endpoint="/api/jobs/cancel"
                    payload={{ jobId: job.id }}
                    label="Cancel"
                    runningLabel="Cancelling..."
                    variant="danger"
                  />
                  {job.manuscriptId ? (
                    <PipelineActionButton
                      endpoint="/api/jobs/kick-inngest"
                      payload={{ manuscriptId: job.manuscriptId }}
                      label="Kick Inngest"
                      runningLabel="Kicking..."
                      variant="primary"
                    />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function whereForFilter(filter: string | undefined, now: Date) {
  switch (filter) {
    case "blocked":
      return { status: PIPELINE_JOB_STATUS.BLOCKED };
    case "locked":
      return { lockedAt: { not: null } };
    case "stale-lock":
      return { lockedAt: { not: null }, lockExpiresAt: { lte: now } };
    case "failed":
      return { status: PIPELINE_JOB_STATUS.FAILED };
    case "inngest-managed":
      return {
        idempotencyKey: {
          contains: "manuscript:"
        }
      };
    case "ready":
    default:
      return {
        status: {
          in: [PIPELINE_JOB_STATUS.QUEUED, PIPELINE_JOB_STATUS.RETRYING]
        },
        OR: [{ readyAt: null }, { readyAt: { lte: now } }]
      };
  }
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}
