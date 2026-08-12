import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { logPathFor, makeLog, readLog, readLogSnapshot, writeLog, writeOpLog } from "../src/store.js";

test("v1 logs remain v1 until a presentation/theme/editor operation requires v2", () => {
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
