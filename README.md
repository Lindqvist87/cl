# Manuscript Intelligence V2

Next.js manuscript analysis and rewrite engine with a database-backed, resumable pipeline.

## Stack

- Next.js App Router, TypeScript, Tailwind
- Vercel deployment target
- Postgres with Prisma and pgvector
- Neon Postgres-compatible schema
- OpenAI API for chunked editorial analysis, benchmarking, trend comparison, rewrite planning, and chapter rewrites
- Deterministic local stubs when `OPENAI_API_KEY` is missing

## What V2 Adds

- Full manuscript pipeline: parse, chapters, chunks, embeddings, chunk summaries, chapter summaries, manuscript profile, chapter audits, whole-book audit, corpus comparison, trend comparison, rewrite plan, and chapter rewrite drafts.
- Literature corpus tables for Project Gutenberg, Litteraturbanken/Sprakbanken, DOAB, manual imports, and private references.
- Rights tracking per corpus book: public domain, open license, licensed, private reference, metadata only, and unknown.
- Trend signal storage for public metadata and market signals without storing copyrighted full text.
- Audit exports as Markdown and JSON.
- Rewritten chapter and full rewritten manuscript Markdown exports.

## Run Locally

1. Copy `.env.example` to `.env`.
2. Start Postgres:

```bash
docker compose up -d
```

3. Install dependencies and apply migrations:

```bash
npm install
npx prisma migrate dev
npx prisma db seed
```

4. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Environment

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/manuscript_audit?schema=public"
OPENAI_API_KEY=""
OPENAI_AUDIT_MODEL="gpt-5.4-mini"
OPENAI_REWRITE_MODEL="gpt-5.5"
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
ENABLE_INNGEST_WORKER="false"
INNGEST_EVENT_KEY=""
INNGEST_SIGNING_KEY=""
NEXT_PUBLIC_APP_NAME="Manuscript Audit"
INNGEST_APP_ID="manuscript-intelligence-app"
INNGEST_SERVE_ORIGIN=""
MAX_JOBS_PER_INNGEST_RUN="3"
MAX_SECONDS_PER_INNGEST_RUN="25"
```

`OPENAI_AUDIT_MODEL` drives v2 audit, corpus, trend, and planning calls. `OPENAI_REWRITE_MODEL` drives chapter rewrite calls. `OPENAI_EMBEDDING_MODEL` drives vector creation. `OPENAI_EDITOR_MODEL` is accepted only as a legacy audit-model fallback when `OPENAI_AUDIT_MODEL` is unset. `OPENAI_FAST_MODEL` is not read by this codebase.

Optional variables read by the app or build scripts:

- `NEXT_PUBLIC_APP_NAME` defaults to `Manuscript Audit`.
- `INNGEST_APP_ID` defaults to `manuscript-intelligence-app`.
- `INNGEST_SERVE_ORIGIN` is only needed when Inngest must be told the public origin explicitly.
- `MAX_JOBS_PER_INNGEST_RUN` defaults to `3`.
- `MAX_SECONDS_PER_INNGEST_RUN` defaults to `25`.
- `OPENAI_INPUT_COST_PER_MILLION_TOKENS_USD` and `OPENAI_OUTPUT_COST_PER_MILLION_TOKENS_USD` enable cost estimates.
- `SKIP_PRISMA_MIGRATE=1` skips the build-time `prisma migrate deploy` helper.
- `INNGEST_DEV`, `APP_URL`, `MANUSCRIPT_ID`, `MAX_JOBS`, and `MAX_SECONDS` are local/dev-script helpers, not required Vercel variables.

## V2 Pipeline

`runFullManuscriptPipeline(manuscriptId)` lives in `lib/pipeline/manuscriptPipeline.ts`.

Steps are checkpointed on `AnalysisRun.checkpoint` and skip completed work on resume:

1. `parseAndNormalizeManuscript`
2. `splitIntoChapters`
3. `splitIntoChunks`
4. `createEmbeddingsForChunks`
5. `summarizeChunks`
6. `summarizeChapters`
7. `createManuscriptProfile`
8. `runChapterAudits`
9. `runWholeBookAudit`
10. `compareAgainstCorpus`
11. `compareAgainstTrendSignals`
12. `createRewritePlan`
13. `generateChapterRewriteDrafts`

The full manuscript is never sent in one model call. Chunk, chapter, whole-book, corpus, trend, rewrite-plan, and chapter-rewrite outputs are persisted in the database.

## Corpus And Rights

Use `/corpus` for manual imports. A rights status is required before import. Full text is only stored for:

- `PUBLIC_DOMAIN`
- `OPEN_LICENSE`
- `LICENSED`
- `PRIVATE_REFERENCE`

`METADATA_ONLY` and `UNKNOWN` records store metadata only. API adapter stubs exist for Gutenberg, Litteraturbanken/Sprakbanken, and DOAB.

## Trends

Use `/trends` to add public metadata signals. Trend rows are metadata and snippets only, not full copyrighted books. Google Books and NYT adapter stubs are present for later credentialed ingestion.

## Deploy On Vercel

1. Provision Neon Postgres with pgvector enabled.
2. Set the exact required Vercel variables:

```bash
DATABASE_URL="<Neon Postgres connection string>"
OPENAI_API_KEY="<OpenAI API key>"
OPENAI_AUDIT_MODEL="gpt-5.4-mini"
OPENAI_REWRITE_MODEL="gpt-5.5"
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
ENABLE_INNGEST_WORKER="true"
INNGEST_EVENT_KEY="<Inngest event key>"
INNGEST_SIGNING_KEY="<Inngest signing key>"
```

3. Run Prisma migrations against Neon during deployment or from a trusted local machine:

```bash
npx prisma migrate deploy
```

4. Deploy the Next.js app to Vercel.

## Durable Background Execution With Inngest

Inngest is the preferred production execution layer. The database `PipelineJob` table remains the source of truth for job state, locking, retries, idempotency, dependencies, and stored AI outputs. Inngest orchestrates jobs; it does not replace the job state machine.

Install and run locally:

```bash
npm install
npm run dev
npm run inngest:dev
```

The Inngest dev server should sync `http://localhost:3000/api/inngest`. Its UI runs on `http://localhost:8288`.

Required production env vars:

- `ENABLE_INNGEST_WORKER=true`
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`
- `INNGEST_APP_ID=manuscript-intelligence-app`
- `INNGEST_SERVE_ORIGIN` if Vercel needs an explicit public origin
- `MAX_JOBS_PER_INNGEST_RUN`
- `MAX_SECONDS_PER_INNGEST_RUN`

On Vercel, keep `/api/inngest` on the Node.js runtime for Prisma compatibility. The endpoint exports `GET`, `POST`, and `PUT`, and sets a long `maxDuration` for bounded background batches.

When a manuscript pipeline starts, the app creates or resumes `PipelineJob` rows, sends `manuscript/pipeline.started`, and returns immediately when `ENABLE_INNGEST_WORKER=true`. Inngest then runs bounded batches and re-emits work until the manuscript is complete, failed, blocked, or cancelled.

Fallback mode remains available. If `ENABLE_INNGEST_WORKER=false`, or Inngest keys are missing, the existing request runner still works, `/api/jobs/run-next` and `/api/jobs/run-until-idle` can process manual batches, and the manuscript page exposes a manual fallback button.

To resume a stuck pipeline:

```bash
MANUSCRIPT_ID="<id>" npm run pipeline:resume
MANUSCRIPT_ID="<id>" npm run jobs:run-until-idle
```

Inspect runs in the Inngest dashboard, `/admin/inngest`, and `/admin/jobs`. `/admin/jobs` includes filters for Inngest-managed, ready, blocked, locked, stale lock, and failed jobs, plus retry/cancel/kick controls.

Limitations:

- The corpus and trend import events currently orchestrate the existing metadata/profile/chunk services; uploads are still accepted by the existing API route first.
- DB-controlled attempts are the retry source of truth, so Inngest functions avoid throwing after a `PipelineJob` records a retryable failure.
- The full manuscript is never sent in one model call. Chunk, chapter, whole-book, corpus, trend, rewrite-plan, and chapter-rewrite outputs remain persisted in the database.

## Tests

```bash
npm test
```

Tests cover chapter parsing, chunking, pipeline checkpoint idempotency, Inngest event payloads, job dependency rules, retry decisions, stale lock detection, fallback mode, and rewrite continuity canon.
