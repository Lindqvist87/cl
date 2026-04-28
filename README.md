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
OPENAI_EDITOR_MODEL="gpt-5.5"
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
NEXT_PUBLIC_APP_NAME="Manuscript Audit"
```

`OPENAI_EDITOR_MODEL` drives the v2 structured editorial services. The older MVP audit/rewrite model variables are still accepted for compatibility with the legacy route code.

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
2. Set `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_EDITOR_MODEL`, and `OPENAI_EMBEDDING_MODEL` in Vercel project settings.
3. Run Prisma migrations against Neon during deployment or from a trusted local machine:

```bash
npx prisma migrate deploy
```

4. Deploy the Next.js app to Vercel.

Long analysis jobs can exceed serverless duration for very large manuscripts. The v2 pipeline is resumable, so failed or timed-out jobs can be rerun and will skip completed steps and stored AI outputs.

## Tests

```bash
npm test
```

Tests cover chapter parsing, chunking, and pipeline checkpoint idempotency.
