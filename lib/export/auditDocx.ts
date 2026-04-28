import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from "docx";
import type { AuditReport } from "@prisma/client";
import type { AuditReportJson } from "@/lib/types";

export async function auditReportToDocxBuffer(report: AuditReport, title: string) {
  const structured = report.structured as AuditReportJson;
  const children: Paragraph[] = [
    new Paragraph({
      text: `Manuscript Audit: ${title}`,
      heading: HeadingLevel.TITLE
    }),
    heading("Executive Summary"),
    paragraph(structured.executiveSummary)
  ];

  children.push(heading("Top 20 Issues"));
  for (const issue of structured.topIssues ?? []) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `[${issue.severity.toUpperCase()}] `, bold: true }),
          new TextRun({ text: issue.title, bold: true }),
          new TextRun({ text: issue.chapter ? ` (${issue.chapter})` : "" })
        ]
      }),
      paragraph(`Recommendation: ${issue.recommendation}`)
    );
  }

  children.push(heading("Chapter-by-Chapter Notes"));
  for (const chapter of structured.chapterNotes ?? []) {
    children.push(
      new Paragraph({
        text: chapter.chapter,
        heading: HeadingLevel.HEADING_3
      }),
      paragraph(`Priority: ${chapter.priority}`),
      ...chapter.notes.map((note) => paragraph(`- ${note}`))
    );
  }

  children.push(heading("Recommended Rewrite Strategy"), paragraph(structured.rewriteStrategy));

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

function heading(text: string) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1
  });
}

function paragraph(text: string) {
  return new Paragraph({
    children: [new TextRun(text)]
  });
}
