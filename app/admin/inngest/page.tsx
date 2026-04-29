import Link from "next/link";
import { getInngestRuntimeConfig } from "@/src/inngest/events";
import { PIPELINE_JOB_STATUS } from "@/lib/pipeline/jobRules";
import { prisma } from "@/lib/prisma";
import { getSystemEnvCheck, type EnvVarCheck } from "@/lib/system/envCheck";

export const dynamic = "force-dynamic";

export default async function AdminInngestPage() {
  const config = getInngestRuntimeConfig();
  const envCheck = getSystemEnvCheck();
  const [lastEvent, lastCompletedJob, heartbeats] = await Promise.all([
    prisma.inngestEventLog.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.pipelineJob.findFirst({
      where: { status: PIPELINE_JOB_STATUS.COMPLETED },
      orderBy: { completedAt: "desc" },
      include: { manuscript: { select: { id: true, title: true } } }
    }),
    prisma.workerHeartbeat.findMany({ orderBy: { updatedAt: "desc" } })
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Inngest</h1>
        <p className="mt-1 text-sm text-slate-600">
          Production background execution status and fallback readiness.
        </p>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <StatusCard label="Worker" value={config.enabled ? "Enabled" : "Disabled"} />
        <StatusCard
          label="Event key"
          value={config.eventKeyPresent ? "Present" : "Missing"}
        />
        <StatusCard
          label="Signing key"
          value={config.signingKeyPresent ? "Present" : "Missing"}
        />
      </section>

      {config.warnings.length > 0 ? (
        <section className="border border-danger bg-white p-4 shadow-panel">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-danger">
            Warnings
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {config.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="border border-line bg-white p-4 shadow-panel">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            System Check
          </h2>
          <div className="mt-3 grid gap-4 text-sm md:grid-cols-2 lg:grid-cols-1">
            <EnvCheckGroup
              title="Required Vercel Variables"
              checks={envCheck.required}
            />
            <EnvCheckGroup title="Optional Variables" checks={envCheck.optional} />
          </div>
        </div>

        <div className="border border-line bg-white p-4 shadow-panel">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Recent Activity
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row
              label="Last event sent"
              value={
                lastEvent
                  ? `${lastEvent.eventName} (${lastEvent.status}) at ${lastEvent.createdAt.toLocaleString()}`
                  : "none"
              }
            />
            <Row
              label="Last job completed"
              value={
                lastCompletedJob
                  ? `${lastCompletedJob.type} at ${lastCompletedJob.completedAt?.toLocaleString() ?? "unknown"}`
                  : "none"
              }
            />
          </dl>
          {lastCompletedJob?.manuscript ? (
            <Link
              href={`/manuscripts/${lastCompletedJob.manuscript.id}`}
              className="mt-3 inline-block text-sm text-accent hover:underline"
            >
              {lastCompletedJob.manuscript.title}
            </Link>
          ) : null}
        </div>
      </section>

      <section className="border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Worker Heartbeats
          </h2>
        </div>
        <div className="divide-y divide-line">
          {heartbeats.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No worker heartbeat has been recorded yet.
            </div>
          ) : (
            heartbeats.map((heartbeat) => (
              <div
                key={heartbeat.id}
                className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[160px_120px_1fr]"
              >
                <div className="font-semibold">{heartbeat.workerType}</div>
                <div>{heartbeat.status}</div>
                <div className="text-slate-500">
                  {heartbeat.lastSeenAt.toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line bg-white p-4 shadow-panel">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
    </div>
  );
}

function EnvCheckGroup({
  title,
  checks
}: {
  title: string;
  checks: EnvVarCheck[];
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      <dl className="mt-2 space-y-2">
        {checks.map((check) => (
          <Row key={check.name} label={check.name} value={check.status} />
        ))}
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-words font-semibold">{value}</dd>
    </div>
  );
}
