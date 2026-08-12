import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { readLog } from "../../dist/store.js";
import { applyTransaction } from "../../dist/transaction.js";

test("CLI batch and library transaction produce identical operation logs and structured results", async () => {
  const directory = mkdtempSync(join(tmpdir(), "straightedge-cli-e2e-"));
  const cliSource = join(directory, "cli.mmd");
  const apiSource = join(directory, "api.mmd");
  const mermaid = "flowchart LR\n  a[A] --> b[B] --> c[C]\n";
  const ops = [
    { op: "align_nodes", nodes: ["a", "b", "c"], edge: "top" },
    { op: "distribute_nodes", nodes: ["a", "b", "c"], axis: "horizontal", gap: 64 },
  ];
  try {
    writeFileSync(cliSource, mermaid);
    writeFileSync(apiSource, mermaid);
    const cli = spawnSync(process.execPath, [
      join(process.cwd(), "dist/cli.js"),
      "apply",
      cliSource,
      JSON.stringify(ops),
      "--json",
    ], { encoding: "utf8" });
    assert.ok([0, 1].includes(cli.status), cli.stderr);
    const output = JSON.parse(cli.stdout);
    assert.equal(output.committed, true);
    assert.equal(output.frame.active, false);
    assert.ok(Array.isArray(output.problems));

    const library = await applyTransaction(apiSource, ops);
    assert.equal(library.committed, true);
    assert.deepEqual(readLog(cliSource), readLog(apiSource));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
