import assert from "node:assert/strict";
import { test } from "node:test";

import { checkSummary, presentationProblems, visualProblems } from "../src/diagnostics.js";
import type { FrameStatus, Layout, VisualMeasurements } from "../src/types.js";

const layout: Layout = {
  nodes: {
    box: { id: "box", label: "Long label", x: 0, y: 0, width: 60, height: 30, shape: "rect" },
  },
  edges: [],
};
const frame: FrameStatus = { active: false, satisfied: true, width: 100, height: 100, contentScale: 1, effectiveFontSize: 16 };

test("visual diagnostics produce a safe, structured resize for label overflow", () => {
  const visual: VisualMeasurements = {
    nodes: [{
      id: "box",
      shape: "rect",
      shapeBounds: { x: 0, y: 0, width: 60, height: 30 },
      labelBounds: { x: -5, y: 5, width: 70, height: 20 },
    }],
    edgeLabels: [],
  };
  const [problem] = visualProblems(layout, visual, frame, 12);

  assert.equal(problem?.kind, "text_overflow");
  assert.equal(problem?.severity, "error");
  assert.equal(problem?.safeToAutoApply, true);
  assert.deepEqual(problem?.nodes, ["box"]);
  assert.deepEqual(problem?.suggestedOps, [{ op: "resize_node", node: "box", width: 86, height: 36 }]);
});

test("shape-aware circle containment catches diagonal label overflow", () => {
  const circleLayout: Layout = {
    nodes: { circle: { id: "circle", label: "Wide", x: 0, y: 0, width: 50, height: 50, shape: "circle" } },
    edges: [],
  };
  const visual: VisualMeasurements = {
    nodes: [{
      id: "circle",
      shape: "circle",
      shapeBounds: { x: 0, y: 0, width: 50, height: 50 },
      labelBounds: { x: 2.5, y: 12.5, width: 45, height: 25 },
    }],
    edgeLabels: [],
  };
  const [problem] = visualProblems(circleLayout, visual, frame, 12);
  assert.equal(problem?.kind, "text_overflow");
  const suggestion = problem?.suggestedOps[0];
  assert.equal(suggestion?.op, "resize_node");
  if (suggestion?.op !== "resize_node") throw new Error("expected a resize suggestion");
  assert.ok((suggestion.width ?? 0) > 50);
  assert.equal(suggestion.width, suggestion.height);
});

test("an unsatisfied frame produces a publication-blocking minimum-font problem", () => {
  const problems = visualProblems(layout, { nodes: [], edgeLabels: [] }, {
    active: true,
    satisfied: false,
    width: 200,
    height: 100,
    contentScale: 0.5,
    effectiveFontSize: 8,
  }, 12);
  assert.equal(problems[0]?.kind, "minimum_font_size");
  assert.equal(problems[0]?.subjects.frame, true);
});

test("check summaries make a bounded success claim and name blocking results honestly", () => {
  assert.equal(checkSummary("geometry", []).claim, "No blocking problems were detected by the active checks.");
  const errors = visualProblems(layout, { nodes: [{
    id: "box",
    shape: "rect",
    shapeBounds: { x: 0, y: 0, width: 60, height: 30 },
    labelBounds: { x: -5, y: 5, width: 70, height: 20 },
  }], edgeLabels: [] }, frame, 12);
  assert.equal(checkSummary("geometry", errors).claim, "Blocking problems were detected by the active checks.");
  assert.equal(checkSummary("presentation", [], false).completed, false);
});

test("presentation advisories carry evidence and direction checks are scoped to edited pairs", () => {
  const directed: Layout = {
    nodes: {
      a: { id: "a", label: "a", x: 100, y: 0, width: 20, height: 20, shape: "rect" },
      b: { id: "b", label: "b", x: 0, y: 0, width: 20, height: 20, shape: "rect" },
    },
    edges: [{ id: "a-b", source: "a", target: "b", points: [{ x: 100, y: 10 }, { x: 0, y: 10 }] }],
  };
  const canvas = { width: 140, height: 60 };
  assert.equal(presentationProblems(directed, canvas, canvas, "LR", new Set()).some((item) => item.kind === "direction_contradiction"), false);
  const problems = presentationProblems(directed, canvas, canvas, "LR", new Set(["b"]));
  const direction = problems.find((item) => item.kind === "direction_contradiction");
  assert.equal(direction?.severity, "warning");
  assert.equal(direction?.evidence?.direction, "LR");
});
