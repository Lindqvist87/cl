# Manuscript Audit MVP

Production-oriented MVP for manuscript upload, parsing, chunked AI analysis, audit reporting, and a demo chapter rewrite flow.

## Stack

- Next.js App Router, TypeScript, Tailwind
- Postgres with Prisma
- pgvector-ready schema via `Unsupported("vector(1536)")`
- OpenAI API, with deterministic local stubs when `OPENAI_API_KEY` is missing
- `.txt` and `.docx` import, Markdown report export, basic DOCX report export route
- pgvector is enabled through a custom migration with `CREATE EXTENSION IF NOT EXISTS vector`

## Run locally

1. Copy `.env.example` to `.env`.
2. Start Postgres:

```bash
docker compose up -d
```

3. Install dependencies and create the database schema:

```bash
npm install
npx prisma migrate dev --name init
```

4. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

Prisma Studio may not be able to display tables with `vector` columns. Use the app UI or SQL queries for chunk records if Studio complains about the unsupported vector type.

## Git-hosted content and deployment

Editable app copy starts in `content/app-copy.json`, so text-only changes can be made through GitHub, Codex, or a local editor and then deployed by pushing the repo.

For repository setup, production environment variables, and hosting notes, see `docs/git-hosting-workflow.md`.

## Architecture notes

- The full manuscript is never sent to the model in a single request.
- Upload parsing creates chapters, scenes, paragraphs, and chunks.
- Analysis runs are resumable: each pass/chunk output is stored with a unique scope key, and reruns skip completed outputs.
- The pipeline builds batch summaries, pass summaries, and a global manuscript memory object instead of sending all chunk outputs to one prompt.
- Every AI response is persisted in `AnalysisOutput`.
- The trend engine is intentionally a stubbed interface for MVP 1.
