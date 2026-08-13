import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { logPathFor, readLog } from "../../dist/store.js";

function structured(response) {
  const detail = response.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n") || "MCP response contained no structured content";
  assert.notEqual(response.isError, true, detail);
  assert.ok(response.structuredContent, detail);
  return response.structuredContent;
}

test("MCP tools share ordered edits, scoped checks, history, undo, reset, and restore contracts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "straightedge-mcp-e2e-"));
  const source = join(directory, "mcp.mmd");
  writeFileSync(source, "flowchart LR\n  a[Alpha]\n  b[Beta]\n  c[Charlie]\n");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist/cli.js"), "mcp"],
    cwd: process.cwd(),
    env: process.env.STRAIGHTEDGE_CHROMIUM_NO_SANDBOX
      ? { STRAIGHTEDGE_CHROMIUM_NO_SANDBOX: process.env.STRAIGHTEDGE_CHROMIUM_NO_SANDBOX }
      : {},
    stderr: "pipe",
  });
  const client = new Client({ name: "straightedge-contract-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    for (const name of ["distribute_nodes", "row_nodes", "stack_nodes", "history", "explain", "undo", "reset_layout", "restore_layout"]) {
      assert.ok(listed.tools.some((tool) => tool.name === name), `missing MCP tool: ${name}`);
    }

    const distributed = structured(await client.callTool({ name: "distribute_nodes", arguments: {
      path: source,
      nodes: ["c", "a", "b"],
      axis: "horizontal",
      order: "given",
      gap: 48,
    } }));
    assert.equal(distributed.committed, true);
    assert.equal(distributed.check.completed, true);
    assert.equal(distributed.check.claim, "No blocking problems were detected by the active checks.");
    assert.equal(readLog(source).version, 3);
    assert.deepEqual(readLog(source).ops[0].nodes, ["c", "a", "b"]);

    const history = structured(await client.callTool({ name: "history", arguments: { path: source } }));
    assert.equal(history.trace[0].state, "effective");
    const checked = structured(await client.callTool({ name: "check_layout", arguments: { path: source, profile: "presentation" } }));
    assert.equal(checked.check.profile, "presentation");
    assert.equal(checked.check.completed, true);

    const undone = structured(await client.callTool({ name: "undo", arguments: { path: source } }));
    assert.equal(undone.committed, true);
    assert.equal(undone.removed.op, "distribute_nodes");

    await client.callTool({ name: "row_nodes", arguments: { path: source, nodes: ["a", "b", "c"], gap: 48 } });
    const beforeReset = readFileSync(logPathFor(source), "utf8");
    const preview = structured(await client.callTool({ name: "reset_layout", arguments: { path: source } }));
    assert.equal(preview.committed, false);
    assert.equal(readFileSync(logPathFor(source), "utf8"), beforeReset);
    const reset = structured(await client.callTool({ name: "reset_layout", arguments: { path: source, confirm: true } }));
    assert.equal(reset.committed, true);
    assert.ok(reset.backupPath);
    const restored = structured(await client.callTool({ name: "restore_layout", arguments: {
      path: source,
      backupPath: reset.backupPath,
      confirm: true,
    } }));
    assert.equal(restored.committed, true);
    assert.equal(readFileSync(logPathFor(source), "utf8"), beforeReset);
  } finally {
    await transport.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
