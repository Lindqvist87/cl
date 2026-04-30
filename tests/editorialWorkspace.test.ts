import test from "node:test";
import assert from "node:assert/strict";
import { transitionDecisionStatus } from "../lib/editorial/decisions";
import { nextBestEditorialAction } from "../lib/editorial/nextAction";
import { aggregateEditorialWorkspaceData } from "../lib/editorial/workspaceData";

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
    recommendation: "Align the motivation with the established promise."
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
      status: "UPLOADED"
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
  assert.equal(workspace.chapterRows.find((chapter) => chapter.id === "c2")?.issueCount, 0);
  assert.equal(workspace.rewritePlanItems.length, 1);
  assert.equal(workspace.nextAction?.targetChapter.id, "c1");
});
