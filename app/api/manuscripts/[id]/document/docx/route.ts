import { prisma } from "@/lib/prisma";
import { manuscriptDocumentToDocxBuffer } from "@/lib/export/manuscriptDocumentDocx";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const manuscript = await prisma.manuscript.findUnique({
    where: { id },
    select: {
      title: true,
      originalText: true
    }
  });

  if (!manuscript) {
    return new Response("Manuscript not found.", { status: 404 });
  }

  const buffer = await manuscriptDocumentToDocxBuffer({
    title: manuscript.title,
    text: manuscript.originalText
  });
  const body = new Uint8Array(buffer.byteLength);
  body.set(buffer);
  const fileName = `${safeFileName(manuscript.title)}.docx`;

  return new Response(body, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": buffer.byteLength.toString()
    }
  });
}

function safeFileName(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
