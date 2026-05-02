import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).optional(),
  AUDIT_MODEL: z.string().min(1).optional(),
  AUDIT_REASONING_EFFORT: z.string().min(1).optional(),
  CHIEF_EDITOR_MODEL: z.string().min(1).optional(),
  CHIEF_EDITOR_REASONING_EFFORT: z.string().min(1).optional(),
  OPENAI_AUDIT_MODEL: z.string().min(1).optional(),
  OPENAI_REWRITE_MODEL: z.string().min(1).default("gpt-5.5"),
  OPENAI_EDITOR_MODEL: z.string().min(1).optional(),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Manuscript Audit")
});

export const env = envSchema.parse({
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || undefined,
  AUDIT_MODEL: process.env.AUDIT_MODEL || undefined,
  AUDIT_REASONING_EFFORT: process.env.AUDIT_REASONING_EFFORT || undefined,
  CHIEF_EDITOR_MODEL: process.env.CHIEF_EDITOR_MODEL || undefined,
  CHIEF_EDITOR_REASONING_EFFORT:
    process.env.CHIEF_EDITOR_REASONING_EFFORT || undefined,
  OPENAI_AUDIT_MODEL: process.env.OPENAI_AUDIT_MODEL || undefined,
  OPENAI_REWRITE_MODEL: process.env.OPENAI_REWRITE_MODEL,
  OPENAI_EDITOR_MODEL: process.env.OPENAI_EDITOR_MODEL || undefined,
  OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME
});
