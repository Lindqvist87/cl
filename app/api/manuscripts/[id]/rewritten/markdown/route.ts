import { prisma } from "@/lib/prisma";
import { buildRewrittenMarkdown } from "@/lib/export/rewriteExports";

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

  const markdown = buildRewrittenMarkdown(manuscript, { includeDrafts });

  const fileName = `${safeFileName(manuscript.title)}-rewritten.md`;

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`
    }
  });
}

function safeFileName(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
