import assert from "node:assert/strict";
import { test } from "node:test";

import { TOOLS } from "../src/mcp.js";
import { opSchema } from "../src/schemas.js";

test("MCP advertises the ADR-0007 workflow and accepts its persistent operations", () => {
  for (const name of ["distribute_nodes", "row_nodes", "stack_nodes", "history", "explain", "undo", "reset_layout", "restore_layout"]) {
    assert.ok(TOOLS.includes(name as (typeof TOOLS)[number]), `missing MCP tool: ${name}`);
  }
  assert.deepEqual(opSchema.parse({
    op: "distribute_nodes",
    nodes: ["ingest", "enrich", "model", "database"],
    axis: "horizontal",
    order: "given",
  }).nodes, ["ingest", "enrich", "model", "database"]);
  assert.equal(opSchema.parse({ op: "row_nodes", nodes: ["a", "b"], gap: 24 }).op, "row_nodes");
  assert.equal(opSchema.parse({ op: "stack_nodes", nodes: ["a", "b"], gap: 24 }).op, "stack_nodes");
});
