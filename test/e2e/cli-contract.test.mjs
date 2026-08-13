import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { logPathFor, readLog } from "../../dist/store.js";
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

test("CLI persists explicit order and exposes history, explain, and dry-run migration", () => {
  const directory = mkdtempSync(join(tmpdir(), "straightedge-cli-adr0007-"));
  const source = join(directory, "ordered.mmd");
  const cliPath = join(process.cwd(), "dist/cli.js");
  const run = (...args) => spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
  try {
    writeFileSync(source, "flowchart LR\n  a[A] --> b[B] --> c[C]\n");
    const distributed = run("distribute", source, "c", "a", "b", "--axis", "horizontal", "--gap", "48", "--json");
    assert.ok([0, 1].includes(distributed.status), distributed.stderr);
    const log = readLog(source);
    assert.equal(log.version, 3);
    assert.deepEqual(log.ops.at(-1), {
      op: "distribute_nodes",
      nodes: ["c", "a", "b"],
      axis: "horizontal",
      order: "given",
      gap: 48,
    });

    const history = run("history", source, "--json");
    assert.equal(history.status, 0, history.stderr);
    assert.equal(JSON.parse(history.stdout)[0].state, "effective");
    const explain = run("explain", source, "--json");
    assert.equal(explain.status, 0, explain.stderr);
    const explained = JSON.parse(explain.stdout);
    assert.equal(explained.diagnosticProfile, "presentation");
    assert.equal(explained.claim, "No blocking problems were detected by the active checks.");

    writeFileSync(logPathFor(source), JSON.stringify({
      version: 2,
      ops: [{ op: "distribute_nodes", nodes: ["b", "a", "c"], axis: "horizontal" }],
    }, null, 2) + "\n");
    const legacyBytes = readFileSync(logPathFor(source), "utf8");
    const migration = run("migrate", source, "--dry-run", "--json");
    assert.equal(migration.status, 0, migration.stderr);
    assert.equal(JSON.parse(migration.stdout).log.ops[0].order, "current");
    assert.equal(readFileSync(logPathFor(source), "utf8"), legacyBytes);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
