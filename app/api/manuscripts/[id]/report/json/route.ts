import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const report = await prisma.auditReport.findFirst({
    where: { manuscriptId: id },
    orderBy: { createdAt: "desc" },
    include: { manuscript: true }
  });

  if (!report) {
    return new Response("Report not found.", { status: 404 });
  }

  const fileName = `${safeFileName(report.manuscript.title)}-audit.json`;

  return Response.json(report.structured, {
    headers: {
      "Content-Disposition": `attachment; filename="${fileName}"`
    }
  });
}

function safeFileName(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
