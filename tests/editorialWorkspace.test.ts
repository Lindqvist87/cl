import test from "node:test";
import assert from "node:assert/strict";
import { transitionDecisionStatus } from "../lib/editorial/decisions";
import { nextBestEditorialAction } from "../lib/editorial/nextAction";
import {
  aggregateEditorialWorkspaceData,
  buildNextActionDisplayData,
  calculateWorkspaceReadiness,
  groupEditorialIssuesByType
} from "../lib/editorial/workspaceData";

const chapters = [
  { id: "c1", order: 1, title: "Opening", status: "PENDING", wordCount: 3000 },
  { id: "c2", order: 2, title: "Breakout", status: "PENDING", wordCount: 3200 }
];

const findings = [
  {
    id: "f1",
    chapterId: "c1",
    issueType: "Pacing",
    severity: 2,
    problem: "Opening spends too long in setup.",
    recommendation: "Move the inciting pressure earlier."
  },
  {
    id: "f2",
    chapterId: "c2",
    issueType: "Continuity",
    severity: 5,
    problem: "Character motivation contradicts the prior chapter.",
    recommendation: "Align the motivation with the established promise.",
    rewriteInstruction: "Rewrite the motivation beat before changing later scenes."
  }
];

test("next best editorial action prioritizes the highest impact chapter", () => {
  const action = nextBestEditorialAction({
    chapters,
    findings,
    decisions: [],
    rewrites: []
  });

  assert.equal(action?.targetChapter.id, "c2");
  assert.equal(action?.relatedIssueIds.includes("f2"), true);
  assert.equal(action?.priority, "high");
  assert.equal(action?.severity, 5);
  assert.equal(action?.issueCount, 1);
  assert.equal(
    action?.suggestedFirstStep,
    "Rewrite the motivation beat before changing later scenes."
  );
});

test("decision status transitions are explicit and immutable", () => {
  const decision = {
    title: "Fix pacing",
    status: "NEEDS_REVIEW" as const
  };

  const accepted = transitionDecisionStatus(decision, "ACCEPTED");

  assert.equal(decision.status, "NEEDS_REVIEW");
  assert.equal(accepted.status, "ACCEPTED");
});

test("accepted rejected and deferred decisions remove findings from action ranking", () => {
  for (const status of ["ACCEPTED", "REJECTED", "DEFERRED"] as const) {
    const action = nextBestEditorialAction({
      chapters,
      findings,
      decisions: [
        {
          id: `d-${status}`,
          findingId: "f2",
          title: "Continuity decision",
          status,
          scope: "CHAPTER",
          updatedAt: new Date("2026-04-30T10:00:00Z")
        }
      ]
    });

    assert.equal(action?.targetChapter.id, "c1");
    assert.deepEqual(action?.relatedIssueIds, ["f1"]);
  }
});

test("no recommendation is returned when there are no chapters or findings", () => {
  const action = nextBestEditorialAction({
    chapters: [],
    findings: [],
    decisions: []
  });

  assert.equal(action, null);
});

test("workspace data aggregation rolls up issues decisions and next action", () => {
  const workspace = aggregateEditorialWorkspaceData({
    manuscript: {
      id: "m1",
      title: "Draft",
      status: "UPLOADED",
      analysisStatus: "COMPLETED"
    },
    chapters,
    findings,
    decisions: [
      {
        id: "d1",
        findingId: "f2",
        chapterId: "c2",
        title: "Continuity decision",
        status: "ACCEPTED",
        scope: "CHAPTER",
        updatedAt: new Date("2026-04-30T10:00:00Z")
      }
    ],
    rewrites: [],
    rewritePlans: [
      {
        id: "rp1",
        createdAt: new Date("2026-04-30T09:00:00Z"),
        chapterPlans: [
          {
            chapterId: "c1",
            title: "Opening",
            priority: 1,
            plan: "Tighten setup and sharpen the hook."
          }
        ]
      }
    ]
  });

  assert.equal(workspace.keyIssues.length, 1);
  assert.equal(workspace.keyIssues[0].id, "f1");
  assert.deepEqual(workspace.readiness, {
    sectionsDetected: 2,
    issuesFound: 2,
    globalSummaryAvailable: false,
    rewritePlanAvailable: true,
    decisionsStored: true,
    analysisStatus: "COMPLETED"
  });
  assert.equal(workspace.issueGroups.length, 1);
  assert.equal(workspace.issueGroups[0].issueType, "Pacing");
  assert.equal(workspace.chapterRows.find((chapter) => chapter.id === "c2")?.issueCount, 0);
  assert.equal(workspace.structureRows.find((section) => section.id === "c2")?.issueCount, 1);
  assert.equal(workspace.rewritePlanItems.length, 1);
  assert.equal(workspace.nextAction?.targetChapter.id, "c1");
  assert.equal(workspace.nextActionDisplay?.selectedSection, "Section 1: Opening");
  assert.equal(workspace.nextActionDisplay?.suggestedFirstStep, "Move the inciting pressure earlier.");
});

test("workspace data aggregation includes lightweight structure review rows", () => {
  const workspace = aggregateEditorialWorkspaceData({
    manuscript: {
      id: "m1",
      title: "Draft",
      status: "UPLOADED"
    },
    chapters: [
      { id: "c1", order: 1, title: "Chapter 1", status: "PENDING", wordCount: 2500 },
      { id: "c2", order: 2, title: "Scene 2", status: "PENDING", wordCount: 1200 },
      { id: "c3", order: 3, title: "3.", status: "PENDING", wordCount: 800 }
    ],
    findings: [
      {
        id: "f1",
        chapterId: "c1",
        issueType: "Pacing",
        severity: 2,
        problem: "Opening spends too long in setup.",
        recommendation: "Move the inciting pressure earlier."
      },
      {
        id: "f2",
        chapterId: "c1",
        issueType: "Continuity",
        severity: 3,
        problem: "Motivation is unclear.",
        recommendation: "Clarify the choice."
      }
    ],
    decisions: []
  });

  assert.deepEqual(
    workspace.structureRows.map((row) => ({
      title: row.title,
      wordCount: row.wordCount,
      issueCount: row.issueCount,
      currentType: row.currentType
    })),
    [
      { title: "Chapter 1", wordCount: 2500, issueCount: 2, currentType: "chapter" },
      { title: "Scene 2", wordCount: 1200, issueCount: 0, currentType: "scene" },
      { title: "3.", wordCount: 800, issueCount: 0, currentType: "section" }
    ]
  );
});

test("workspace readiness calculation exposes availability flags", () => {
  const readiness = calculateWorkspaceReadiness({
    manuscript: {
      id: "m1",
      title: "Draft",
      status: "PIPELINE_RUNNING",
      analysisStatus: "RUNNING"
    },
    chapters,
    findings,
    decisions: [],
    rewritePlans: [],
    globalSummary: ""
  });

  assert.deepEqual(readiness, {
    sectionsDetected: 2,
    issuesFound: 2,
    globalSummaryAvailable: false,
    rewritePlanAvailable: false,
    decisionsStored: false,
    analysisStatus: "RUNNING"
  });
});

test("issue grouping counts by type and keeps top priority issues first", () => {
  const grouped = groupEditorialIssuesByType({
    chapters,
    findings: [
      ...findings,
      {
        id: "f3",
        chapterId: "c1",
        issueType: "Pacing",
        severity: 4,
        problem: "Middle scene repeats the opening beat.",
        recommendation: "Compress the repeated beat."
      },
      {
        id: "f4",
        chapterId: "c1",
        issueType: "Pacing",
        severity: 1,
        problem: "Minor sentence rhythm issue.",
        recommendation: "Smooth the sentence."
      }
    ]
  });

  assert.equal(grouped[0].issueType, "Continuity");
  assert.equal(grouped[0].count, 1);
  assert.equal(grouped[0].topIssues[0].id, "f2");
  assert.equal(grouped[1].issueType, "Pacing");
  assert.equal(grouped[1].count, 3);
  assert.deepEqual(
    grouped[1].topIssues.map((issue) => issue.id),
    ["f3", "f1", "f4"]
  );
});

test("next action display data includes selected section and first step", () => {
  const action = nextBestEditorialAction({
    chapters,
    findings,
    decisions: [],
    rewrites: []
  });
  const display = buildNextActionDisplayData(action);

  assert.equal(display?.selectedSection, "Section 2: Breakout");
  assert.equal(display?.severity, 5);
  assert.equal(display?.issueCount, 1);
  assert.equal(display?.priority, "high");
  assert.equal(
    display?.suggestedFirstStep,
    "Rewrite the motivation beat before changing later scenes."
  );
  assert.match(display?.reason ?? "", /highest severity 5/);
});
