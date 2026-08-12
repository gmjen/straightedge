import assert from "node:assert/strict";
import { test } from "node:test";

import { applyPresentation, minimumFontSize, PRESETS } from "../src/presentation.js";

test("presentation presets produce exact target dimensions and centered logical viewboxes", () => {
  const applied = applyPresentation({ width: 800, height: 400 }, { preset: "slides-16:9" });

  assert.equal(applied.canvas.width, PRESETS["slides-16:9"].width);
  assert.equal(applied.canvas.height, PRESETS["slides-16:9"].height);
  assert.ok((applied.canvas.viewBoxX ?? 0) < 0);
  assert.ok((applied.canvas.viewBoxY ?? 0) <= 0);
  assert.equal(applied.frame.active, true);
  assert.equal(applied.frame.satisfied, true);
});

test("presentation frame refuses an unreadably small fit", () => {
  const applied = applyPresentation(
    { width: 2_000, height: 1_000 },
    { width: 200, height: 100, padding: 10, minFontSize: 12 },
  );

  assert.equal(applied.frame.satisfied, false);
  assert.ok(applied.frame.effectiveFontSize < 12);
  assert.equal(minimumFontSize({ preset: "a4-portrait" }), PRESETS["a4-portrait"].minFontSize);
});

test("transparent and high-density raster controls are retained on the canvas", () => {
  const applied = applyPresentation(
    { width: 300, height: 200 },
    { transparent: true, rasterScale: 2 },
  );
  assert.equal(applied.canvas.transparent, true);
  assert.equal(applied.canvas.rasterScale, 2);
});
