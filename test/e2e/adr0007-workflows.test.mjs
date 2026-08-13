import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { explain, history } from "../../dist/explain.js";
import { openBrowser } from "../../dist/paint.js";
import { logPathFor, readLog, writeLog } from "../../dist/store.js";
import { applyTransaction, resetLayout, restoreLayout, undoTransaction } from "../../dist/transaction.js";

test("ordered intent, explainability, safe undo, reset, and restore hold across browser-backed workflows", async () => {
  const directory = mkdtempSync(join(tmpdir(), "straightedge-adr0007-e2e-"));
  const source = join(directory, "workflow.mmd");
  const browser = await openBrowser();
  try {
    writeFileSync(source, "flowchart LR\n  a[Alpha] --> b[Beta] --> c[Charlie]\n");
    const ordered = await applyTransaction(source, [{
      op: "row_nodes",
      nodes: ["c", "a", "b"],
      gap: 48,
      align: "center",
    }], { browser });
    assert.equal(ordered.committed, true);
    assert.equal(readLog(source).version, 3);
    assert.deepEqual(readLog(source).ops[0]?.nodes, ["c", "a", "b"]);

    const beforeInvalid = readFileSync(logPathFor(source), "utf8");
    const invalid = await applyTransaction(source, [{
      op: "stack_nodes",
      nodes: ["a", "missing"],
      gap: 32,
    }], { browser });
    assert.equal(invalid.committed, false);
    assert.match(invalid.reason ?? "", /skipped.*missing/);
    assert.equal(readFileSync(logPathFor(source), "utf8"), beforeInvalid);

    writeLog(source, [
      { op: "resize_node", node: "a", width: 120 },
      { op: "resize_node", node: "a", width: 140 },
      { op: "move_node", node: "a", dx: 4, dy: 0 },
      { op: "move_node", node: "ghost", dx: 1, dy: 1 },
    ], 3);
    const trace = await history(source, browser);
    assert.deepEqual(trace.map((item) => item.state), ["overridden", "effective", "effective", "skipped"]);

    writeLog(source, [{ op: "row_nodes", nodes: ["c", "b", "a"], gap: 48 }], 3);
    const explanation = await explain(source, browser);
    assert.equal(explanation.sourceDirection, "LR");
    assert.ok(explanation.findings.some((finding) => finding.kind === "direction_conflict"));

    const original = readFileSync(logPathFor(source), "utf8");
    const preview = await resetLayout(source, { browser });
    assert.equal(preview.committed, false);
    assert.match(preview.backupPath ?? "", /\.straightedge\/backups\/workflow\//);
    assert.equal(readFileSync(logPathFor(source), "utf8"), original);

    const reset = await resetLayout(source, { confirm: true, browser });
    assert.equal(reset.committed, true);
    assert.ok(reset.backupPath && existsSync(reset.backupPath));
    assert.equal(readFileSync(reset.backupPath, "utf8"), original);
    assert.equal(existsSync(logPathFor(source)), false);

    const restorePreview = await restoreLayout(source, reset.backupPath, { browser });
    assert.equal(restorePreview.committed, false);
    assert.equal(existsSync(logPathFor(source)), false);
    const restored = await restoreLayout(source, reset.backupPath, { confirm: true, browser });
    assert.equal(restored.committed, true);
    assert.equal(readFileSync(logPathFor(source), "utf8"), original);

    const sidecarBeforeFailedUndo = readFileSync(logPathFor(source), "utf8");
    writeFileSync(source, "this is not valid Mermaid\n");
    await assert.rejects(() => undoTransaction(source, browser));
    assert.equal(readFileSync(logPathFor(source), "utf8"), sidecarBeforeFailedUndo);
  } finally {
    await browser.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
