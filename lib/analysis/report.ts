import type { AuditReportJson, IssueSeverity } from "@/lib/types";

const SEVERITY_RANK: Record<IssueSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
};

export function normalizeReport(report: AuditReportJson): AuditReportJson {
  const topIssues = [...(report.topIssues ?? [])]
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, 20);

  return {
    executiveSummary: report.executiveSummary || "No executive summary generated.",
    topIssues,
    chapterNotes: report.chapterNotes ?? [],
    rewriteStrategy: report.rewriteStrategy || "No rewrite strategy generated.",
    metadata: report.metadata
  };
}

export function auditReportToMarkdown(report: AuditReportJson, manuscriptTitle: string) {
  const normalized = normalizeReport(report);
  const issueLines = normalized.topIssues
    .map((issue, index) => {
      const chapter = issue.chapter ? ` (${issue.chapter})` : "";
      const evidence = issue.evidence ? `\n   Evidence: ${issue.evidence}` : "";
      return `${index + 1}. [${issue.severity.toUpperCase()}] ${issue.title}${chapter}\n   Recommendation: ${issue.recommendation}${evidence}`;
    })
    .join("\n\n");

  const chapterLines = normalized.chapterNotes
    .map(
      (chapter) =>
        `### ${chapter.chapter}\nPriority: ${chapter.priority}\n\n${chapter.notes
          .map((note) => `- ${note}`)
          .join("\n")}`
    )
    .join("\n\n");

  return [
    `# Manuscript Audit: ${manuscriptTitle}`,
    "",
    "## Executive Summary",
    "",
    normalized.executiveSummary,
    "",
    "## Top 20 Issues",
    "",
    issueLines || "No issues generated.",
    "",
    "## Chapter-by-Chapter Notes",
    "",
    chapterLines || "No chapter notes generated.",
    "",
    "## Recommended Rewrite Strategy",
    "",
    normalized.rewriteStrategy
  ].join("\n");
}
