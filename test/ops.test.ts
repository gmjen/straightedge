/**
 * One test file. Asserts the worked example in SPEC.md §13 to the pixel, plus
 * the handful of behaviours that would be silently wrong if we got them backwards.
 *
 * No mocks, no fixtures, no browser — everything here is pure arithmetic over
 * plain objects, and it runs in milliseconds. If this file ever needs a mock,
 * something has leaked out of ops.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { normalize } from "../src/canvas.js";
import { reanchor } from "../src/edges.js";
import { lint } from "../src/lint.js";
import { replay } from "../src/replay.js";
import type { Layout, Node, Op } from "../src/types.js";

// --- helpers ---------------------------------------------------------------

function node(id: string, x: number, y: number, width: number, height: number): Node {
  return { id, label: id, x, y, width, height, shape: "rect" };
}

function layoutOf(...nodes: Node[]): Layout {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    edges: [],
  };
}

/** The ELK baseline from SPEC.md §13. */
function pipelineBaseline(): Layout {
  const base = layoutOf(
    node("ingest", 0, 0, 96, 54),
    node("enrich", 176, 0, 100, 54),
    node("model", 356, 0, 92, 54),
    node("db", 528, 0, 128, 54),
  );
  base.edges = [
    { id: "e1", source: "ingest", target: "enrich", points: [] },
    { id: "e2", source: "enrich", target: "model", points: [] },
    { id: "e3", source: "model", target: "db", points: [] },
  ];
  return base;
}

/** The op log from SPEC.md §13. */
const PIPELINE_OPS: Op[] = [
  { op: "place_relative", node: "db", reference: "model", side: "below", gap: 80 },
  { op: "equalize_size", nodes: ["ingest", "enrich", "model"], dimension: "width" },
  { op: "distribute_nodes", nodes: ["ingest", "enrich", "model"], axis: "horizontal", gap: 64 },
  { op: "move_node", node: "db", dx: 24, dy: 0 },
];

function geometry(layout: Layout) {
  return Object.fromEntries(
    Object.values(layout.nodes).map((n) => [n.id, { x: n.x, y: n.y, w: n.width, h: n.height }]),
  );
}

// --- the worked example ----------------------------------------------------

test("SPEC §13: resolved geometry before canvas normalization", () => {
  const { layout, warnings } = replay(pipelineBaseline(), PIPELINE_OPS);

  assert.deepEqual(warnings, []);
  assert.deepEqual(geometry(layout), {
    ingest: { x: -2, y: 0, w: 100, h: 54 },
    enrich: { x: 162, y: 0, w: 100, h: 54 },
    model: { x: 326, y: 0, w: 100, h: 54 },
    db: { x: 362, y: 134, w: 128, h: 54 },
  });
});

test("SPEC §13: final positions and canvas after normalization", () => {
  const { layout, moved } = replay(pipelineBaseline(), PIPELINE_OPS);
  const { layout: final, canvas } = normalize(reanchor(layout, moved));

  assert.deepEqual(
    Object.fromEntries(Object.values(final.nodes).map((n) => [n.id, { x: n.x, y: n.y }])),
    {
      ingest: { x: 32, y: 32 },
      enrich: { x: 196, y: 32 },
      model: { x: 360, y: 32 },
      db: { x: 396, y: 166 },
    },
  );
  assert.deepEqual(canvas, { width: 556, height: 252 });
});

test("SPEC §8.1: op order matters — db ends up off-centre from model", () => {
  const { layout } = replay(pipelineBaseline(), PIPELINE_OPS);
  const model = layout.nodes["model"]!;
  const db = layout.nodes["db"]!;

  const modelCentre = model.x + model.width / 2;
  const dbCentre = db.x + db.width / 2;

  // 24px of deliberate nudge, 26px of distribute_nodes having moved the
  // reference after db was placed relative to it. Documented, not a bug.
  assert.equal(dbCentre - modelCentre, 50);

  // ...and reordering so place_relative runs last does centre it.
  const reordered: Op[] = [PIPELINE_OPS[1]!, PIPELINE_OPS[2]!, PIPELINE_OPS[0]!];
  const after = replay(pipelineBaseline(), reordered).layout;
  assert.equal(
    after.nodes["db"]!.x + after.nodes["db"]!.width / 2,
    after.nodes["model"]!.x + after.nodes["model"]!.width / 2,
  );
});

// --- behaviours that would be silently wrong if reversed -------------------

test("a stale op is skipped and the rest of the log still applies", () => {
  const ops: Op[] = [
    { op: "move_node", node: "ghost", dx: 100, dy: 100 },
    { op: "move_node", node: "ingest", dx: 10, dy: 20 },
  ];
  const { layout, warnings } = replay(pipelineBaseline(), ops);

  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /op 0 \(move_node\) skipped: no node ghost/);
  assert.deepEqual({ x: layout.nodes["ingest"]!.x, y: layout.nodes["ingest"]!.y }, { x: 10, y: 20 });
});

test("resize is centre-preserving, not corner-anchored", () => {
  const before = layoutOf(node("a", 100, 100, 50, 50));
  const { layout } = replay(before, [{ op: "resize_node", node: "a", width: 100 }]);

  assert.deepEqual(geometry(layout), { a: { x: 75, y: 100, w: 100, h: 50 } });
});

test("align_nodes anchors on the first node listed", () => {
  const before = layoutOf(node("a", 0, 10, 40, 40), node("b", 100, 90, 40, 40));

  const forwards = replay(before, [{ op: "align_nodes", nodes: ["a", "b"], edge: "top" }]).layout;
  assert.equal(forwards.nodes["b"]!.y, 10);

  const backwards = replay(before, [{ op: "align_nodes", nodes: ["b", "a"], edge: "top" }]).layout;
  assert.equal(backwards.nodes["a"]!.y, 90);
});

test("distribute_nodes sorts by position, not list order", () => {
  const before = layoutOf(node("a", 0, 0, 50, 20), node("b", 400, 0, 50, 20), node("c", 200, 0, 50, 20));
  const { layout } = replay(before, [
    { op: "distribute_nodes", nodes: ["b", "a", "c"], axis: "horizontal", gap: 10 },
  ]);

  assert.equal(layout.nodes["a"]!.x, 0); // leftmost anchors
  assert.equal(layout.nodes["c"]!.x, 60);
  assert.equal(layout.nodes["b"]!.x, 120);
});

test("distribute_nodes with no gap divides the existing span evenly", () => {
  const before = layoutOf(node("a", 0, 0, 50, 20), node("b", 60, 0, 50, 20), node("c", 250, 0, 50, 20));
  const { layout } = replay(before, [
    { op: "distribute_nodes", nodes: ["a", "b", "c"], axis: "horizontal" },
  ]);

  // span 300, occupied 150, so gap = 150 / 2 = 75
  assert.equal(layout.nodes["a"]!.x, 0);
  assert.equal(layout.nodes["b"]!.x, 125);
  assert.equal(layout.nodes["c"]!.x, 250); // last node stays put
});

test("equalize_size uses the maximum so labels never clip", () => {
  const before = layoutOf(node("a", 0, 0, 40, 20), node("b", 100, 0, 90, 20));
  const { layout } = replay(before, [
    { op: "equalize_size", nodes: ["a", "b"], dimension: "width" },
  ]);

  assert.equal(layout.nodes["a"]!.width, 90);
  assert.equal(layout.nodes["b"]!.width, 90);
});

test("lint reports an overlap the agent created", () => {
  const before = layoutOf(node("a", 0, 0, 100, 50), node("b", 300, 0, 100, 50));
  const { layout } = replay(before, [{ op: "move_node", node: "b", dx: -250, dy: 0 }]);

  const problems = lint(layout);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]!.kind, "overlap");
  assert.deepEqual(problems[0]!.nodes.sort(), ["a", "b"]);
});

test("edges follow a moved node", () => {
  const before = layoutOf(node("a", 0, 0, 100, 50), node("b", 300, 0, 100, 50));
  before.edges = [{ id: "e", source: "a", target: "b", points: [] }];

  const { layout, moved } = replay(before, [{ op: "move_node", node: "b", dx: 0, dy: 200 }]);
  const routed = reanchor(layout, moved);

  const [from, to] = routed.edges[0]!.points;
  assert.ok(from && to);
  assert.ok(to.y < layout.nodes["b"]!.y + 1, "edge should arrive at b's top edge");
  assert.ok(from.y > 0, "edge should leave a below its centre");
});

test("touched edges route around an unrelated obstacle", () => {
  const before = layoutOf(
    node("a", 0, 0, 80, 40),
    node("blocker", 140, -20, 80, 80),
    node("b", 280, 0, 80, 40),
  );
  before.edges = [{ id: "e", source: "a", target: "b", points: [] }];

  const routed = reanchor(before, new Set(["a"]));
  assert.ok(routed.edges[0]!.points.length >= 4, "router introduces a dogleg around the blocker");
  assert.equal(lint(routed).some((problem) => problem.kind === "edge_crosses_node"), false);
});

test("replay retains presentation, theme, and explicit reroute intent", () => {
  const result = replay(layoutOf(node("a", 0, 0, 20, 20)), [
    { op: "set_presentation", presentation: { preset: "slides-16:9" } },
    { op: "apply_theme", theme: "executive-light" },
    { op: "reroute_edges", edges: ["e1"] },
  ]);

  assert.deepEqual(result.presentation, { preset: "slides-16:9" });
  assert.equal(result.theme, "executive-light");
  assert.deepEqual([...result.rerouteEdges], ["e1"]);
});

test("lint reports an edge with an obscured arrowhead and suggests rerouting", () => {
  const before = layoutOf(node("a", 0, 0, 40, 20), node("b", 100, 0, 40, 20));
  before.edges = [{ id: "short", source: "a", target: "b", points: [{ x: 40, y: 10 }, { x: 42, y: 10 }] }];
  const issue = lint(before).find((problem) => problem.kind === "obscured_arrowhead");
  assert.equal(issue?.severity, "error");
  assert.deepEqual(issue?.suggestedOps, [{ op: "reroute_edges", edges: ["short"] }]);
});
