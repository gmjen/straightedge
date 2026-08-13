import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { logPathFor, makeLog, readLog, readLogSnapshot, writeLog, writeOpLog } from "../src/store.js";

test("v1/v2 logs retain legacy meaning and ordered operations promote new writes to v3", () => {
  const directory = mkdtempSync(join(tmpdir(), "straightedge-store-"));
  const source = join(directory, "diagram.mmd");
  try {
    writeFileSync(source, "flowchart LR\n a --> b\n");
    writeLog(source, [{ op: "move_node", node: "a", dx: 1, dy: 2 }]);
    assert.equal(readLog(source).version, 1);

    writeLog(source, [
      { op: "move_node", node: "a", dx: 1, dy: 2 },
      { op: "apply_theme", theme: "executive-light" },
    ]);
    assert.equal(readLog(source).version, 2);

    writeLog(source, [
      { op: "apply_theme", theme: "executive-light" },
      { op: "distribute_nodes", nodes: ["a", "b"], axis: "horizontal", order: "given" },
    ]);
    assert.equal(readLog(source).version, 3);

    writeFileSync(logPathFor(source), JSON.stringify({
      version: 2,
      ops: [{ op: "distribute_nodes", nodes: ["b", "a"], axis: "horizontal" }],
    }));
    const legacy = readLog(source);
    assert.equal(legacy.version, 2);
    assert.equal(legacy.ops[0]?.op, "distribute_nodes");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("compare-and-swap rejects a concurrent sidecar change without overwriting it", () => {
  const directory = mkdtempSync(join(tmpdir(), "straightedge-store-"));
  const source = join(directory, "diagram.mmd");
  try {
    writeFileSync(source, "flowchart LR\n a --> b\n");
    writeLog(source, [{ op: "move_node", node: "a", dx: 1, dy: 2 }]);
    const snapshot = readLogSnapshot(source);
    const concurrent = "{\n  \"version\": 1,\n  \"ops\": []\n}\n";
    writeFileSync(logPathFor(source), concurrent);

    assert.throws(
      () => writeOpLog(source, makeLog([{ op: "move_node", node: "b", dx: 3, dy: 4 }]), snapshot.raw),
      /changed during the transaction/,
    );
    assert.equal(readFileSync(logPathFor(source), "utf8"), concurrent);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
