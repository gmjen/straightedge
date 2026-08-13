import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { render, resolve } from "../../dist/render.js";
import { writeLog } from "../../dist/store.js";

test("browser paint fits rectangle and circle outlines while keeping labels unscaled", async () => {
  const directory = mkdtempSync(join(tmpdir(), "straightedge-e2e-"));
  const sourcePath = join(directory, "shapes.mmd");

  try {
    writeFileSync(sourcePath, "flowchart LR\n  box[Box A] --> circle((Circle Y))\n");
    const baseline = await resolve(sourcePath);
    const box = baseline.layout.nodes.box;
    const circle = baseline.layout.nodes.circle;
    const boxWidth = box.width + 40;
    const circleDiameter = circle.width * 0.9;

    writeLog(sourcePath, [
      { op: "resize_node", node: "box", width: boxWidth },
      {
        op: "resize_node",
        node: "circle",
        width: circleDiameter,
        height: circleDiameter,
      },
    ]);

    const result = await render(sourcePath);
    assert.equal(result.problems.some((problem) => problem.kind === "text_overflow"), false);
    assert.equal(result.status, "review", "the 10% smaller circle is supported but its tight padding is reviewable");
    assert.ok(result.png.length > 1_000, "browser returned a non-empty PNG");
    assert.doesNotMatch(result.svg, /NaN|undefined/);

    const rect = shapeTag(result.svg, "rect");
    assert.ok(Math.abs(numberAttribute(rect, "width") - boxWidth) < 0.01);

    const renderedCircle = shapeTag(result.svg, "circle");
    const radius = numberAttribute(renderedCircle, "r");
    const transform = stringAttribute(renderedCircle, "transform");
    const scale = transform.match(/scale\(([-\d.]+),\s*([-\d.]+)\)/);
    assert.ok(scale, "circle has a browser-applied shape fitting transform");
    assert.ok(Math.abs(radius * 2 * Number(scale[1]) - circleDiameter) < 0.01);
    assert.ok(Math.abs(radius * 2 * Number(scale[2]) - circleDiameter) < 0.01);

    assert.match(result.svg, />Circle Y<\/p>/);
    assert.doesNotMatch(result.svg, /class="label"[^>]*transform="[^"]*scale/);
    assert.ok(result.visual.nodes.every((measurement) => measurement.labelBounds.width > 0));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("themed font metrics do not clip labels to Mermaid's pre-theme measurement", async () => {
  const directory = mkdtempSync(join(tmpdir(), "straightedge-theme-label-e2e-"));
  const sourcePath = join(directory, "labels.mmd");

  try {
    writeFileSync(sourcePath, "flowchart LR\n  model[Model] --> db[(Database)]\n");
    writeLog(sourcePath, [{ op: "apply_theme", theme: "executive-light" }]);

    const result = await render(sourcePath);
    assert.match(result.svg, /<foreignObject[^>]*overflow="visible"[^>]*style="overflow: visible;"/);
    for (const id of ["model", "db"]) {
      const node = result.visual.nodes.find((candidate) => candidate.id === id);
      assert.ok(node, `missing visual measurement for ${id}`);
      assert.ok(node.labelBounds.width > 0, `${id} has a measurable themed label`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function shapeTag(svg, tag) {
  const match = svg.match(new RegExp(`<${tag}\\b[^>]*class="basic label-container"[^>]*>`));
  assert.ok(match, `rendered SVG contains a ${tag} label container`);
  return match[0];
}

function stringAttribute(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]+)"`));
  assert.ok(match, `${tag} contains ${name}`);
  return match[1];
}

function numberAttribute(tag, name) {
  return Number(stringAttribute(tag, name));
}
