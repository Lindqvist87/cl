import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; chapterId: string }> }
) {
  const { id, chapterId } = await params;
  const rewrite = await prisma.chapterRewrite.findFirst({
    where: {
      manuscriptId: id,
      chapterId
    },
    orderBy: { createdAt: "desc" },
    include: {
      chapter: true,
      manuscript: true
    }
  });

  if (!rewrite) {
    return new Response("Chapter rewrite not found.", { status: 404 });
  }

  const markdown = [
    `# ${rewrite.manuscript.title} - ${rewrite.chapter.title}`,
    "",
    rewrite.rewrittenText || rewrite.content
  ].join("\n");
  const fileName = `${safeFileName(rewrite.manuscript.title)}-${safeFileName(
    rewrite.chapter.title
  )}-rewrite.md`;

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
