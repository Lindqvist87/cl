import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  const latestRewriteByChapter = new Map<string, string>();
  for (const rewrite of manuscript.rewrites) {
    if (!latestRewriteByChapter.has(rewrite.chapterId)) {
      latestRewriteByChapter.set(
        rewrite.chapterId,
        rewrite.rewrittenText || rewrite.content
      );
    }
  }

  const markdown = [
    `# ${manuscript.title} - Rewritten Draft`,
    "",
    ...manuscript.chapters.flatMap((chapter) => [
      `## ${chapter.title}`,
      "",
      latestRewriteByChapter.get(chapter.id) || chapter.text,
      ""
    ])
  ].join("\n");

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
