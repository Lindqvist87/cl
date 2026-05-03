# Pipeline Robustness Audit

Core rule: durable artifacts win over checkpoint and job metadata. A phase is complete only when the expected database artifact exists for the current manuscript/run, or when the phase explicitly stores a durable skipped state.

| Phase | Input dependency | Durable completion source | Stale risk | Recovery behavior |
| --- | --- | --- | --- | --- |
| `parseAndNormalizeManuscript` | stored source text | `Manuscript.originalText` or word count | checkpoint can claim parsed after a failed upload/import | rerun parse from stored version/source text |
| `splitIntoChapters` | parsed manuscript | at least one `ManuscriptChapter` | checkpoint can claim chapters while rows are missing | rerun chapter normalization; if rows are absent, surface blocker |
| `splitIntoChunks` | chapters | at least one `ManuscriptChunk` | `chunkCount` or checkpoint can be stale | rerun chunk normalization; if chunks are absent, surface blocker |
| `createEmbeddingsForChunks` | chunks | every chunk has `localMetrics.embeddingStatus` of `stored`, `empty`, or `skipped` | job completion can exist while a subset of chunks never received embedding state | reopen/retry embeddings for incomplete chunks |
| `summarizeChunks` | embeddings | every chunk has current-run `CHUNK_ANALYSIS` output or persisted chunk summary | checkpoint/result metadata can report later phases while chunk summaries are partial | reopen/requeue `summarizeChunks` and continue in batches |
| `summarizeChapters` | chunk summaries | every chapter has `Chapter.summary` | chapter-count metadata can be stale | rerun chapter summary aggregation |
| `createManuscriptProfile` | chapter summaries | `ManuscriptProfile` row | checkpoint can claim profile without profile row | rerun profile creation |
| `runChapterAudits` | profile | every chapter has current-run `CHAPTER_AUDIT` output | old chapter summaries or completed jobs can mask missing audit outputs | rerun missing chapter audits |
| `runWholeBookAudit` | chapter audits | current-run `AuditReport` | run status can be completed without report | rerun whole-book audit |
| `compareAgainstCorpus` | whole-book audit | current-run `CORPUS_COMPARISON` output, including skipped output | old `AnalysisOutput` from another run can look valid | rerun/skipped-output comparison for current run |
| `compareAgainstTrendSignals` | corpus comparison | current-run `TREND_COMPARISON` output, including skipped output | old comparison output can be reused accidentally | rerun/skipped-output comparison for current run |
| `createRewritePlan` | trend comparison | current-run `RewritePlan` | checkpoint can claim plan without plan row | rerun rewrite plan creation |
| `generateChapterRewriteDrafts` | rewrite plan | draft or accepted `ChapterRewrite` for each chapter and plan | optional job can be queued before plan is durably present | keep optional and require durable plan first |

## Shortcuts Found

- `plannedPipelineJobs` accepted `checkpoint.completedSteps` as completion source.
- `runManuscriptPipelineStepJob` skipped execution when checkpoint said the step was complete.
- `updateManuscriptPipelineStatus` marked manuscripts complete when all jobs were complete, even if durable outputs were missing.
- Diagnostics and page progress derived current phase mostly from checkpoint/job state.
- The manual runner stopped immediately after stale-lock recovery instead of spending remaining budget on the recovered job.

## Fixes In This PR

- Added `lib/pipeline/durableState.ts` to compute phase state from database artifacts.
- Resume/planning reconciles stale checkpoints before creating or updating jobs.
- Completed jobs are reopened when their durable phase output is incomplete.
- Step execution confirms durable output after a run before marking the step/job complete.
- Manual `runReadyPipelineJobs` continues after stale-lock recovery when budget remains.
- Diagnostics expose durable phase, checkpoint phase, job-status phase, mismatch warnings, recoverability, current phase counts, and stale metadata status.
- Manuscript page/admin progress use reconciled durable checkpoint state for display.

## Known Weak Spots For Follow-Up

- `runFullManuscriptPipeline` still uses checkpoint-only skip logic and should either delegate to the job runner or use durable reconciliation directly. Current usage check: it is not imported by the active author-facing upload/audit/resume routes, admin/manual runner routes, cron-style job routes, or Inngest functions. Those paths call `startManuscriptPipeline`, `ensureManuscriptPipelineJobs`, `runReadyPipelineJobs`, or `runPipelineJob`.
- The durable helper intentionally avoids schema changes; a future run/version identity field on generated artifacts would make stale-output detection stronger.
- Embedding completion uses `localMetrics.embeddingStatus`; this is durable enough for the current schema but weaker than a first-class embedding status column.
- Corpus/trend skipped outputs are considered complete when written for the current run. That is intentional, but diagnostics should keep showing the skip reason clearly.
