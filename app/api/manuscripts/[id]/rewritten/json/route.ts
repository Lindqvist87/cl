import { prisma } from "@/lib/prisma";
import { buildRewrittenJson } from "@/lib/export/rewriteExports";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const includeDrafts = new URL(request.url).searchParams.get("includeDrafts") === "1";
  const manuscript = await prisma.manuscript.findUnique({
    where: { id },
    include: {
      chapters: { orderBy: { order: "asc" } },
      rewrites: {
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!manuscript) {
    return new Response("Manuscript not found.", { status: 404 });
  }

  const fileName = `${safeFileName(manuscript.title)}-rewritten.json`;

  return Response.json(buildRewrittenJson(manuscript, { includeDrafts }), {
    headers: {
      "Content-Disposition": `attachment; filename="${fileName}"`
    }
  });
}

function safeFileName(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
