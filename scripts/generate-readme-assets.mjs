import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { render } from "../dist/render.js";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const assets = join(root, "docs", "assets");
const example = join(root, "examples", "pipeline.mmd");
const sidecar = join(root, "examples", "pipeline.layout.json");
const temporary = mkdtempSync(join(tmpdir(), "straightedge-readme-"));

try {
  mkdirSync(assets, { recursive: true });
  const source = readFileSync(example, "utf8");
  const beforeSource = join(temporary, "pipeline-before.mmd");
  writeFileSync(beforeSource, source);

  const before = await render(beforeSource);
  const after = await render(example, undefined, { profile: "presentation" });
  if (after.problems.some((problem) => problem.severity === "error")) {
    throw new Error(`README after image has blocking diagnostics: ${after.problems.map((problem) => problem.kind).join(", ")}`);
  }
  if (after.canvas.width !== 1200 || after.canvas.height !== 630 || after.check.profile !== "presentation") {
    throw new Error("README after image must use the 1200×630 presentation profile");
  }

  writeFileSync(join(assets, "pipeline-before.png"), before.png);
  writeFileSync(join(assets, "pipeline-after.png"), after.png);
  writeFileSync(join(assets, "pipeline-after.layout.json"), readFileSync(sidecar));
  console.log(`Generated README assets; after status: ${after.status}. ${after.check.claim}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
