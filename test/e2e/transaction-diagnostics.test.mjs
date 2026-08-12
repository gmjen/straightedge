import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { render, resolve } from "../../dist/render.js";
import { logPathFor, writeLog } from "../../dist/store.js";
import { applyTransaction, repair } from "../../dist/transaction.js";

test("a visually unsafe resize rolls back and guarded repair improves a forced bad sidecar", async () => {
  const directory = mkdtempSync(join(tmpdir(), "straightedge-transaction-e2e-"));
  const sourcePath = join(directory, "labels.mmd");
  try {
    writeFileSync(sourcePath, 'flowchart LR\n  box["A deliberately long label"] --> sink[Sink]\n');
    const baseline = await resolve(sourcePath);
    const original = baseline.layout.nodes.box;

    const rejected = await applyTransaction(sourcePath, [{
      op: "resize_node",
      node: "box",
      width: Math.max(20, original.width * 0.35),
      height: original.height,
    }]);
    assert.equal(rejected.committed, false);
    assert.equal(rejected.result.status, "failed");
    assert.ok(rejected.result.problems.some((problem) => problem.kind === "text_overflow"));
    assert.equal(existsSync(logPathFor(sourcePath)), false, "failed transaction never creates a sidecar");

    writeLog(sourcePath, [{
      op: "resize_node",
      node: "box",
      width: Math.max(20, original.width * 0.35),
      height: original.height,
    }]);
    const badBytes = readFileSync(logPathFor(sourcePath), "utf8");
    const before = await render(sourcePath);
    assert.equal(before.status, "failed");

    const repaired = await repair(sourcePath);
    assert.equal(repaired.committed, true);
    assert.ok(repaired.appliedOps.some((op) => op.op === "resize_node"));
    assert.equal(repaired.result.problems.some((problem) => problem.kind === "text_overflow"), false);
    assert.notEqual(readFileSync(logPathFor(sourcePath), "utf8"), badBytes);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a coherent alignment and spacing request commits as one sidecar update", async () => {
  const directory = mkdtempSync(join(tmpdir(), "straightedge-transaction-e2e-"));
  const sourcePath = join(directory, "batch.mmd");
  try {
    writeFileSync(sourcePath, "flowchart LR\n  a[A] --> b[B] --> c[C]\n");
    const transaction = await applyTransaction(sourcePath, [
      { op: "align_nodes", nodes: ["a", "b", "c"], edge: "top" },
      { op: "distribute_nodes", nodes: ["a", "b", "c"], axis: "horizontal", gap: 72 },
    ]);
    assert.equal(transaction.committed, true);
    const parsed = JSON.parse(readFileSync(logPathFor(sourcePath), "utf8"));
    assert.equal(parsed.ops.length, 2);
    assert.equal(parsed.ops[0].op, "align_nodes");
    assert.equal(parsed.ops[1].gap, 72);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
