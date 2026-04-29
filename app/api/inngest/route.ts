import { serve } from "inngest/next";
import { inngest } from "@/src/inngest/client";
import { inngestFunctions } from "@/src/inngest/functions";

export const runtime = "nodejs";
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
  serveOrigin: process.env.INNGEST_SERVE_ORIGIN
});
