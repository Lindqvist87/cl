import test from "node:test";
import assert from "node:assert/strict";
import { transitionDecisionStatus } from "../lib/editorial/decisions";
import { buildAuthorWorkspaceViewModel } from "../lib/editorial/authorWorkspace";
import { aggregateEditorialFindingPriorities } from "../lib/editorial/findingAggregation";
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

const aggregationChapters = [
  { id: "s1", order: 1, title: "I", status: "PENDING", wordCount: 1 },
  { id: "s2", order: 2, title: "Warehouse", status: "PENDING", wordCount: 1800 },
  { id: "s3", order: 3, title: "The call", status: "PENDING", wordCount: 1600 },
  { id: "s4", order: 4, title: "Aftermath", status: "PENDING", wordCount: 1700 }
];

const systemicConflictFindings = [
  {
    id: "short-s5",
    chapterId: "s1",
    issueType: "Character",
    severity: 5,
    problem: "No character is present in this section.",
    evidence: "I",
    recommendation: "Confirm whether this is a heading or merge it into the next section."
  },
  {
    id: "conflict-1",
    chapterId: "s2",
    issueType: "Conflict",
    severity: 3,
    problem: "No clear conflict drives the scene.",
    evidence: "The scene observes the room without a visible pressure point.",
    recommendation: "Add an obstacle and a choice."
  },
  {
    id: "conflict-2",
    chapterId: "s3",
    issueType: "Conflict",
    severity: 3,
    problem: "No conflict or stakes shape the exchange.",
    evidence: "The call repeats information without forcing a decision.",
    recommendation: "Make the call force a commitment."
  },
  {
    id: "conflict-3",
    chapterId: "s4",
    issueType: "Conflict",
    severity: 3,
    problem: "No dramatic pressure changes the aftermath.",
    evidence: "Characters process events without a new risk.",
    recommendation: "Tie the aftermath to a consequence."
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
  assert.equal(workspace.editorialPriorities.length, 1);
  assert.equal(workspace.issueGroups[0].issueType, "Pacing");
  assert.equal(workspace.chapterRows.find((chapter) => chapter.id === "c2")?.issueCount, 0);
  assert.equal(workspace.structureRows.find((section) => section.id === "c2")?.issueCount, 1);
  assert.equal(workspace.rewritePlanItems.length, 1);
  assert.equal(workspace.nextAction?.targetChapter.id, "c1");
  assert.equal(workspace.nextActionDisplay?.selectedSection, "Section 1: Opening");
  assert.equal(
    workspace.nextActionDisplay?.suggestedFirstStep,
    "Identify the first irreversible pressure beat and decide whether it can appear in the opening sequence."
  );
});

test("repeated findings aggregate into one editorial priority with examples", () => {
  const priorities = aggregateEditorialFindingPriorities({
    chapters: aggregationChapters,
    findings: [
      {
        id: "char-1",
        chapterId: "s2",
        issueType: "Character",
        severity: 4,
        problem: "No clear character anchors the scene.",
        recommendation: "Name the viewpoint owner."
      },
      {
        id: "char-2",
        chapterId: "s3",
        issueType: "Character",
        severity: 4,
        problem: "No protagonist or viewpoint controls the exchange.",
        recommendation: "Clarify whose desire shapes the beat."
      },
      {
        id: "char-3",
        chapterId: "s4",
        issueType: "Character",
        severity: 3,
        problem: "The section lacks a character anchor.",
        recommendation: "Assign the section to a character arc."
      }
    ]
  });

  assert.equal(priorities.length, 1);
  assert.equal(priorities[0].title, "Sections without clear character anchoring");
  assert.equal(priorities[0].issueCount, 3);
  assert.deepEqual(priorities[0].rawFindingIds, ["char-1", "char-2", "char-3"]);
  assert.equal(priorities[0].representativeFindings.length, 3);
});

test("near duplicate priorities with the same normalized title merge into one", () => {
  const priorities = aggregateEditorialFindingPriorities({
    chapters: aggregationChapters,
    findings: [
      {
        id: "move-section",
        chapterId: "s2",
        issueType: "Movement",
        severity: 3,
        problem: "No clear movement changes the scene.",
        recommendation: "Define the scene turn before polishing."
      },
      {
        id: "move-chunk",
        chapterId: "s3",
        chunkId: "chunk-1",
        issueType: "Movement",
        severity: 3,
        problem: "The chunk has little scene movement.",
        recommendation: "Define the scene turn before polishing."
      }
    ]
  });

  assert.equal(priorities.length, 1);
  assert.equal(priorities[0].title, "Sections with little scene movement");
  assert.equal(priorities[0].issueCount, 2);
  assert.deepEqual(priorities[0].rawFindingIds.sort(), ["move-chunk", "move-section"]);
  assert.deepEqual(priorities[0].affectedSectionIds, ["s2", "s3"]);
});

test("corpus benchmark prefix is stripped from display title and guidance", () => {
  const priorities = aggregateEditorialFindingPriorities({
    chapters: aggregationChapters,
    findings: [
      {
        id: "corpus-architecture",
        chapterId: "s2",
        issueType: "corpus-benchmark",
        severity: 4,
        problem:
          "corpus-benchmark: Chapter architecture is fragmented compared with benchmark openings.",
        recommendation:
          "corpus-benchmark: Consolidate split beats into clearer chapter architecture."
      }
    ]
  });

  assert.equal(priorities.length, 1);
  assert.equal(priorities[0].title, "Fragmented chapter architecture");
  assert.equal(
    priorities[0].recommendedAction,
    "Consolidate split beats into clearer chapter architecture."
  );
  assert.equal(priorities[0].title.includes("corpus-benchmark"), false);
});

test("raw issue type remains available as priority metadata", () => {
  const priorities = aggregateEditorialFindingPriorities({
    chapters: aggregationChapters,
    findings: [
      {
        id: "corpus-architecture",
        chapterId: "s2",
        issueType: "corpus-benchmark",
        severity: 4,
        problem: "corpus-benchmark: Chapter architecture is fragmented.",
        recommendation: "corpus-benchmark: Merge accidental fragment beats."
      }
    ]
  });

  assert.equal(priorities[0].issueType, "corpus-benchmark");
  assert.deepEqual(priorities[0].rawIssueTypes, ["corpus-benchmark"]);
  assert.equal(priorities[0].representativeFindings[0].issueType, "corpus-benchmark");
});

test("short title-only section issues do not dominate top priority alone", () => {
  const priorities = aggregateEditorialFindingPriorities({
    chapters: aggregationChapters,
    findings: systemicConflictFindings
  });

  assert.equal(priorities[0].title, "Repeated missing conflict or dramatic pressure");
  assert.equal(priorities[0].displayPriority, "high");
  assert.equal(priorities[0].rawSeverityRange, "S3");
  assert.equal(priorities[1].title, "Possible false splits and fragment sections");
  assert.equal(priorities[1].displayPriority, "low");
  assert.equal(priorities[1].rawSeverityRange, "S5");
  assert.equal(priorities[1].hasFragmentContext, true);
});

test("systemic issue outranks isolated severe issue in display priority", () => {
  const priorities = aggregateEditorialFindingPriorities({
    chapters: aggregationChapters,
    findings: systemicConflictFindings
  });

  assert.equal(priorities[0].issueCount, 3);
  assert.equal(priorities[0].rawSeverityMax, 3);
  assert.equal(priorities[1].issueCount, 1);
  assert.equal(priorities[1].rawSeverityMax, 5);
  assert.ok(priorities[0].displayScore > priorities[1].displayScore);
});

test("workspace next best action uses aggregated priority", () => {
  const workspace = aggregateEditorialWorkspaceData({
    manuscript: {
      id: "m1",
      title: "Draft",
      status: "UPLOADED"
    },
    chapters: aggregationChapters,
    findings: systemicConflictFindings,
    decisions: []
  });

  assert.equal(workspace.nextAction?.sourcePriorityId, workspace.editorialPriorities[0].priorityId);
  assert.equal(workspace.nextAction?.targetChapter.id, "s2");
  assert.equal(
    workspace.nextAction?.actionTitle,
    "Clarify what pressure, obstacle, or choice drives the affected sections."
  );
  assert.match(workspace.nextActionDisplay?.reason ?? "", /display priority high/);
  assert.equal(
    workspace.nextActionDisplay?.whatToIgnoreForNow,
    "Do not tune prose rhythm or minor continuity rows until the scene pressure is legible."
  );
});

test("author workspace maps aggregated priorities into author-facing cards", () => {
  const workspace = aggregateEditorialWorkspaceData({
    manuscript: {
      id: "m1",
      title: "Draft",
      status: "UPLOADED",
      analysisStatus: "COMPLETED"
    },
    chapters: aggregationChapters,
    findings: systemicConflictFindings,
    decisions: [],
    globalSummary:
      "The manuscript has a clear core but several scenes need stronger dramatic pressure. Handle the repeated scene-pressure pattern before smaller edits."
  });
  const authorWorkspace = buildAuthorWorkspaceViewModel(workspace);

  assert.equal(authorWorkspace.hero.title, "Här är det viktigaste att arbeta med");
  assert.equal(authorWorkspace.start.heading, "Börja här");
  assert.equal(
    authorWorkspace.start.title,
    "Förtydliga vilket hinder, val eller vilken press som driver de berörda delarna."
  );
  assert.equal(authorWorkspace.start.primaryEnabled, true);
  assert.equal(authorWorkspace.start.targetSectionId, "s2");
  assert.equal(authorWorkspace.priorityCards.length, 2);
  assert.deepEqual(authorWorkspace.priorityCards[0], {
    id: workspace.editorialPriorities[0].priorityId,
    title: "Dramatiskt tryck saknas i flera avsnitt",
    importanceLabel: "Hög viktighet",
    affectedParts: ["Del 2: Warehouse", "Del 3: The call", "Del 4: Aftermath"],
    whyItMatters:
      "Scener utan tydlig press, konflikt eller insats tappar framåtrörelse och gör senare stegring svagare.",
    recommendedAction:
      "Förtydliga vilket hinder, val eller vilken press som driver de berörda delarna.",
    targetSectionId: "s2"
  });
});

test("author workspace keeps raw findings secondary instead of primary", () => {
  const workspace = aggregateEditorialWorkspaceData({
    manuscript: {
      id: "m1",
      title: "Draft",
      status: "UPLOADED"
    },
    chapters: aggregationChapters,
    findings: systemicConflictFindings,
    decisions: []
  });
  const authorWorkspace = buildAuthorWorkspaceViewModel(workspace);
  const mainLabels = authorWorkspace.mainSectionLabels.join(" ");

  assert.equal(workspace.keyIssues.length, 4);
  assert.equal(
    workspace.issueGroups.reduce((total, group) => total + group.count, 0),
    4
  );
  assert.equal(authorWorkspace.details.summaryLabel, "Visa detaljer");
  assert.equal(authorWorkspace.details.rawFindingsLabel, "Alla observationer");
  assert.doesNotMatch(
    mainLabels,
    /Workspace readiness|Pipeline|Raw findings|Next Best Editorial Action|Detected sections|Severity|Findings/
  );
  assert.doesNotMatch(mainLabels, /Alla observationer|Analysen är redo/);
});

test("author workspace renders helpful fallback when analysis data is missing", () => {
  const workspace = aggregateEditorialWorkspaceData({
    manuscript: {
      id: "m1",
      title: "Draft",
      status: "UPLOADED",
      analysisStatus: "NOT_STARTED"
    },
    chapters: [],
    findings: [],
    decisions: [],
    rewritePlans: [],
    globalSummary: null
  });
  const authorWorkspace = buildAuthorWorkspaceViewModel(workspace);

  assert.equal(workspace.nextActionDisplay, null);
  assert.equal(authorWorkspace.hero.title, "Analysen behöver mer underlag");
  assert.match(authorWorkspace.hero.body, /viktigaste prioritet och nästa steg/);
  assert.equal(authorWorkspace.start.heading, "Börja här");
  assert.equal(authorWorkspace.start.primaryEnabled, false);
  assert.equal(
    authorWorkspace.start.title,
    "Analysen saknar ännu en tydlig första prioritet"
  );
  assert.equal(authorWorkspace.priorityCards.length, 0);
});

test("raw findings remain available beside aggregated priorities", () => {
  const workspace = aggregateEditorialWorkspaceData({
    manuscript: {
      id: "m1",
      title: "Draft",
      status: "UPLOADED"
    },
    chapters: aggregationChapters,
    findings: systemicConflictFindings,
    decisions: []
  });

  assert.equal(workspace.keyIssues.length, 4);
  assert.equal(
    workspace.issueGroups.reduce((total, group) => total + group.count, 0),
    4
  );
  assert.deepEqual(
    workspace.editorialPriorities.flatMap((priority) => priority.rawFindingIds).sort(),
    systemicConflictFindings.map((finding) => finding.id).sort()
  );
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
