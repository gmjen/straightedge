import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { render, renderWithOps } from "../dist/render.js";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const assets = join(root, "docs", "assets");
const example = join(root, "examples", "pipeline.mmd");
const sidecar = join(root, "examples", "pipeline.layout.json");
const reviewExample = join(root, "examples", "review-gate.mmd");
const reviewSidecar = join(root, "examples", "review-gate.layout.json");
const temporary = mkdtempSync(join(tmpdir(), "straightedge-readme-"));

try {
  mkdirSync(assets, { recursive: true });
  const source = readFileSync(example, "utf8");
  const beforeSource = join(temporary, "pipeline-before.mmd");
  writeFileSync(beforeSource, source);

  const pipelineLog = JSON.parse(readFileSync(sidecar, "utf8"));
  const before = await render(beforeSource);
  const layout = await renderWithOps(example, pipelineLog.ops.slice(0, 4));
  const after = await render(example, undefined, { profile: "presentation" });
  assertReadable("pipeline layout", layout);
  assertReadable("pipeline after", after);
  if (after.canvas.width !== 1200 || after.canvas.height !== 630 || after.check.profile !== "presentation") {
    throw new Error("README after image must use the 1200×630 presentation profile");
  }

  const reviewLog = JSON.parse(readFileSync(reviewSidecar, "utf8"));
  const [reviewFrame, reviewResize] = reviewLog.ops;
  const reviewBefore = await renderWithOps(reviewExample, [reviewFrame]);
  const reviewAfter = await renderWithOps(reviewExample, [reviewFrame, reviewResize]);
  assertReadable("review gate before", reviewBefore);
  assertReadable("review gate after", reviewAfter, { allowPaddingWarning: true });
  if (reviewBefore.canvas.width !== 720 || reviewBefore.canvas.height !== 240 || reviewAfter.canvas.width !== 720 || reviewAfter.canvas.height !== 240) {
    throw new Error("Review-gate comparison must use matching 720×240 frames");
  }

  writeFileSync(join(assets, "pipeline-before.png"), before.png);
  writeFileSync(join(assets, "pipeline-layout.png"), layout.png);
  writeFileSync(join(assets, "pipeline-after.png"), after.png);
  writeFileSync(join(assets, "pipeline-after.layout.json"), readFileSync(sidecar));
  writeFileSync(join(assets, "review-gate-before.png"), reviewBefore.png);
  writeFileSync(join(assets, "review-gate-after.png"), reviewAfter.png);
  writeFileSync(join(assets, "review-gate-after.layout.json"), readFileSync(reviewSidecar));
  console.log(`Generated README assets; after status: ${after.status}. ${after.check.claim}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function assertReadable(label, result, { allowPaddingWarning = false } = {}) {
  const blocking = result.problems.filter((problem) => problem.severity === "error");
  if (blocking.length > 0) {
    throw new Error(`${label} has blocking diagnostics: ${blocking.map((problem) => problem.kind).join(", ")}`);
  }
  const labelProblems = result.problems.filter((problem) =>
    problem.kind === "text_overflow" || (!allowPaddingWarning && problem.kind === "text_touches_boundary"));
  if (labelProblems.length > 0) {
    throw new Error(`${label} has unsafe label geometry: ${labelProblems.map((problem) => problem.message).join("; ")}`);
  }
}
