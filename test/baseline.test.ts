import assert from "node:assert/strict";
import { test } from "node:test";

import { baseline, type LayoutData } from "../src/baseline.js";

test("ELK baseline preserves Mermaid IDs, labels, sizes, and edge identity", async () => {
  const data: LayoutData = {
    type: "flowchart-v2",
    direction: "LR",
    nodes: [
      { id: "source", label: "Source", shape: "squareRect", width: 80, height: 40 },
      { id: "sink", label: "Sink", shape: "cylinder", width: 100, height: 60 },
    ],
    edges: [{ id: "L_source_sink_0", start: "source", end: "sink", label: "ships" }],
  };

  const layout = await baseline(data);

  assert.deepEqual(Object.keys(layout.nodes), ["source", "sink"]);
  assert.equal(layout.nodes.source!.label, "Source");
  assert.equal(layout.nodes.sink!.shape, "cylinder");
  assert.equal(layout.nodes.source!.width, 80);
  assert.ok(layout.nodes.sink!.x > layout.nodes.source!.x, "LR puts the sink to the right");
  assert.deepEqual(
    { id: layout.edges[0]!.id, source: layout.edges[0]!.source, target: layout.edges[0]!.target },
    { id: "L_source_sink_0", source: "source", target: "sink" },
  );
  assert.ok(layout.edges[0]!.points.length >= 2);
});

test("baseline rejects subgraphs rather than returning incorrect geometry", async () => {
  const data: LayoutData = {
    type: "flowchart-v2",
    direction: "TB",
    nodes: [
      { id: "cluster", label: "Cluster", width: 100, height: 100, isGroup: true },
      { id: "inside", label: "Inside", width: 80, height: 40, parentId: "cluster" },
    ],
    edges: [],
  };

  await assert.rejects(baseline(data), /does not support subgraphs/);
});
