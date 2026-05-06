import test from "node:test";
import assert from "node:assert/strict";
import {
  chiefEditorCoverageMap,
  wholeBookCoverageMap
} from "../lib/compiler/compiler";

test("whole book coverage map surfaces missing chapter capsules", () => {
  const coverage = wholeBookCoverageMap({
    chapterCount: 3,
    chapterCapsules: [{ chapterId: "c1" }],
    facts: [{ chapterId: "c1" }, { chapterId: "c2" }],
    events: [{ chapterId: "c3" }]
  });

  assert.equal(coverage.incomplete, true);
  assert.equal(coverage.chapterCapsuleCount, 1);
  assert.deepEqual(coverage.coveredChapterIds, ["c1"]);
  assert.match(coverage.uncertainties[0] ?? "", /Only 1 of 3/);
});

test("chief editor coverage map keeps final pass off raw manuscript assumptions", () => {
  const coverage = chiefEditorCoverageMap({
    wholeBookMap: null,
    chapterCapsules: [],
    findings: [{ id: "finding-1" }]
  });

  assert.equal(coverage.hasWholeBookMap, false);
  assert.equal(coverage.prioritizedFindingCount, 1);
  assert.deepEqual(coverage.uncertainties, [
    "Whole-book map is missing.",
    "Chapter capsules are missing."
  ]);
});

