# Git and hosting workflow

<!-- Preview deploy refresh: 2026-05-03; documentation-only no-op. -->

This project is a Next.js app with API routes, Prisma, and Postgres. It should be hosted on a platform that supports a Node.js server runtime and environment variables, such as Vercel, Render, Fly.io, or a similar app host. It is not a plain static site for GitHub Pages.

## Source of truth

- Code, UI copy, and docs live in the git repository.
- First-pass editable app copy lives in `content/app-copy.json`.
- Secrets stay out of git. Use `.env` locally and production environment variables in the hosting provider.

## Editing copy

For simple text changes, edit `content/app-copy.json` in GitHub, in Codex, or locally. Commit and push the change; the host should redeploy from the connected branch.

Good copy-only workflow:

```bash
git checkout -b copy/update-dashboard-text
git add content/app-copy.json
git commit -m "Update dashboard copy"
git push -u origin copy/update-dashboard-text
```

Then open a pull request, or merge to the deployment branch if the repo is small and you are working solo.

## Connect a remote repository

Use either an existing empty repository or create a new one on GitHub.

```bash
git remote add origin https://github.com/Lindqvist87/<repo-name>.git
git branch -M main
git push -u origin main
```

After this, connect the repository to the hosting provider and set the deployment branch to `main`.

## Production environment variables

Set these in the hosting provider:

```bash
DATABASE_URL="postgresql://..."
DATABASE_URL_UNPOOLED="postgresql://..."
OPENAI_API_KEY="..."
AUDIT_MODEL="gpt-5.4-mini"
AUDIT_REASONING_EFFORT="medium"
CHIEF_EDITOR_MODEL="gpt-5.4"
CHIEF_EDITOR_REASONING_EFFORT="high"
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
ENABLE_INNGEST_WORKER="true"
INNGEST_EVENT_KEY="<Inngest event key>"
INNGEST_SIGNING_KEY="<Inngest signing key>"
```

The production database needs Postgres with the `vector` extension available because the Prisma migration enables `pgvector`.

## Deploy sequence

1. Push the repository to GitHub.
2. Create or connect a managed Postgres database.
3. Add the production or preview environment variables.
4. Let the configured Vercel build command run database migrations before `next build`:

```bash
npm run build
```

The package build script calls `scripts/apply-migrations-if-configured.mjs`, which runs `prisma migrate deploy`. On Vercel, the build fails before runtime when neither `DATABASE_URL` nor `DATABASE_URL_UNPOOLED` is configured. When both URLs exist, `DATABASE_URL_UNPOOLED` is used for migrations and `DATABASE_URL` remains the runtime connection string. `SKIP_PRISMA_MIGRATE=1` is the only supported skip value and should only be used when migrations are deliberately applied by another trusted process.

5. Deploy the Next.js app from the connected git branch.

From there, content changes can happen through the repo and flow into the hosted app automatically.

## PR #34 preview migration check

PR #34 introduces the compiler foundation migration:

```text
prisma/migrations/20260503190000_manuscript_compiler_foundation/migration.sql
```

This migration creates the compiler persistence tables used by `buildManuscriptNodes` and the downstream compiler steps: `ManuscriptNode`, `CompilerArtifact`, `NarrativeFact`, `CharacterState`, `PlotEvent`, and `StyleFingerprint`.

Before testing the preview/manual pipeline on a Vercel preview deployment, confirm the Neon preview branch has applied the migration:

```sql
SELECT to_regclass('public."ManuscriptNode"');
```

The query should return `ManuscriptNode`. If it returns null, rerun the preview deployment with the correct Neon preview `DATABASE_URL` or `DATABASE_URL_UNPOOLED` configured so `prisma migrate deploy` can apply the pending migration.
