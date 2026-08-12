import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { render } from "../../dist/render.js";
import { readLog, writeLog } from "../../dist/store.js";

test("a slide preset, curated theme, and semantic roles render to exact deck dimensions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "straightedge-presentation-e2e-"));
  const sourcePath = join(directory, "slide.mmd");
  try {
    writeFileSync(sourcePath, "flowchart LR\n  a[Input] --> b[Decision] --> c[Output]\n");
    writeLog(sourcePath, [
      { op: "apply_theme", theme: "executive-light" },
      { op: "style_nodes", nodes: ["b"], style: { role: "critical" } },
      { op: "set_presentation", presentation: { preset: "slides-16:9", background: "#ffffff" } },
    ]);

    const result = await render(sourcePath);
    assert.equal(readLog(sourcePath).version, 2);
    assert.deepEqual({ width: result.canvas.width, height: result.canvas.height }, { width: 1600, height: 900 });
    assert.equal(result.frame.active, true);
    assert.equal(result.frame.satisfied, true);
    assert.equal(result.problems.some((problem) => problem.kind === "minimum_font_size"), false);
    assert.match(result.svg, /width="1600"/);
    assert.match(result.svg, /height="900"/);
    assert.match(result.svg, /#fee2e2/);
    assert.deepEqual(pngDimensions(result.png), { width: 1600, height: 900 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function pngDimensions(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
