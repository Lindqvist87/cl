import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from "docx";

type ManuscriptDocumentDocxInput = {
  title: string;
  text: string | null;
};

export async function manuscriptDocumentToDocxBuffer(
  input: ManuscriptDocumentDocxInput
) {
  const children = [
    new Paragraph({
      text: input.title,
      heading: HeadingLevel.TITLE
    }),
    ...textToDocxParagraphs(input.text)
  ];

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
