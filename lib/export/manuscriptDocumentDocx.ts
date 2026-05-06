import {
  Document,
  PageBreak,
  Packer,
  Paragraph,
  TextRun
} from "docx";
import { splitDocumentIntoPages } from "@/lib/document/pageMarkers";

type ManuscriptDocumentDocxInput = {
  title: string;
  text: string | null;
};

export async function manuscriptDocumentToDocxBuffer(
  input: ManuscriptDocumentDocxInput
) {
  const pages = splitDocumentIntoPages(input.text);
  const children = pages.flatMap((page, index) => [
      ...(index > 0 ? [pageBreakParagraph()] : []),
      ...textToDocxParagraphs(page.text)
    ]);

  const doc = new Document({
    sections: [
      {
        properties: {},
        children
      }
    ]
  });

  return Packer.toBuffer(doc);
}

export function textToDocxParagraphs(text: string | null) {
  const normalized = (text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.trim()
    ? normalized.split(/\n{2,}/)
    : [""];

  return blocks.map((block) => {
    const lines = block.split("\n");
    const children = lines.map((line, index) =>
      index === 0
        ? new TextRun(line)
        : new TextRun({
            text: line,
            break: 1
          })
    );

    return new Paragraph({
      children
    });
  });
}

function pageBreakParagraph() {
  return new Paragraph({
    children: [new PageBreak()]
  });
}
