import { uploadPostHandler } from "@/lib/server/uploadImport";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  return uploadPostHandler(request);
}
