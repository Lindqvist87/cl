import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  EXTRACTION_MODEL: z.string().min(1).optional(),
  EXTRACTION_REASONING_EFFORT: z.string().min(1).optional(),
  AUDIT_MODEL: z.string().min(1).optional(),
  AUDIT_REASONING_EFFORT: z.string().min(1).optional(),
  SCENE_ANALYSIS_MODEL: z.string().min(1).optional(),
  SCENE_ANALYSIS_REASONING_EFFORT: z.string().min(1).optional(),
  CHAPTER_COMPILER_MODEL: z.string().min(1).optional(),
  CHAPTER_COMPILER_REASONING_EFFORT: z.string().min(1).optional(),
  WHOLE_BOOK_COMPILER_MODEL: z.string().min(1).optional(),
  WHOLE_BOOK_COMPILER_REASONING_EFFORT: z.string().min(1).optional(),
  CHIEF_EDITOR_MODEL: z.string().min(1).optional(),
  CHIEF_EDITOR_REASONING_EFFORT: z.string().min(1).optional(),
  REWRITE_REASONING_EFFORT: z.string().min(1).optional(),
  OPENAI_AUDIT_MODEL: z.string().min(1).optional(),
  OPENAI_REWRITE_MODEL: z.string().min(1).optional(),
  OPENAI_EDITOR_MODEL: z.string().min(1).optional(),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Manuscript Audit"),
  AUTO_GENERATE_FULL_BOOK_REWRITES: z.string().min(1).default("false"),
  ENABLE_INNGEST_WORKER: z.string().min(1).optional(),
  INNGEST_APP_ID: z.string().min(1).optional(),
  INNGEST_EVENT_KEY: z.string().min(1).optional(),
  INNGEST_SIGNING_KEY: z.string().min(1).optional(),
  MAX_JOBS_PER_INNGEST_RUN: z.string().min(1).optional(),
  MAX_SECONDS_PER_INNGEST_RUN: z.string().min(1).optional()
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL || undefined,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || undefined,
  EXTRACTION_MODEL: process.env.EXTRACTION_MODEL || undefined,
  EXTRACTION_REASONING_EFFORT:
    process.env.EXTRACTION_REASONING_EFFORT || undefined,
  AUDIT_MODEL: process.env.AUDIT_MODEL || undefined,
  AUDIT_REASONING_EFFORT: process.env.AUDIT_REASONING_EFFORT || undefined,
  SCENE_ANALYSIS_MODEL: process.env.SCENE_ANALYSIS_MODEL || undefined,
  SCENE_ANALYSIS_REASONING_EFFORT:
    process.env.SCENE_ANALYSIS_REASONING_EFFORT || undefined,
  CHAPTER_COMPILER_MODEL: process.env.CHAPTER_COMPILER_MODEL || undefined,
  CHAPTER_COMPILER_REASONING_EFFORT:
    process.env.CHAPTER_COMPILER_REASONING_EFFORT || undefined,
  WHOLE_BOOK_COMPILER_MODEL:
    process.env.WHOLE_BOOK_COMPILER_MODEL || undefined,
  WHOLE_BOOK_COMPILER_REASONING_EFFORT:
    process.env.WHOLE_BOOK_COMPILER_REASONING_EFFORT || undefined,
  CHIEF_EDITOR_MODEL: process.env.CHIEF_EDITOR_MODEL || undefined,
  CHIEF_EDITOR_REASONING_EFFORT:
    process.env.CHIEF_EDITOR_REASONING_EFFORT || undefined,
  REWRITE_REASONING_EFFORT: process.env.REWRITE_REASONING_EFFORT || undefined,
  OPENAI_AUDIT_MODEL: process.env.OPENAI_AUDIT_MODEL || undefined,
  OPENAI_REWRITE_MODEL: process.env.OPENAI_REWRITE_MODEL || undefined,
  OPENAI_EDITOR_MODEL: process.env.OPENAI_EDITOR_MODEL || undefined,
  OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  AUTO_GENERATE_FULL_BOOK_REWRITES:
    process.env.AUTO_GENERATE_FULL_BOOK_REWRITES,
  ENABLE_INNGEST_WORKER: process.env.ENABLE_INNGEST_WORKER || undefined,
  INNGEST_APP_ID: process.env.INNGEST_APP_ID || undefined,
  INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY || undefined,
  INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY || undefined,
  MAX_JOBS_PER_INNGEST_RUN:
    process.env.MAX_JOBS_PER_INNGEST_RUN || undefined,
  MAX_SECONDS_PER_INNGEST_RUN:
    process.env.MAX_SECONDS_PER_INNGEST_RUN || undefined
});
