/** Shared inspect/render pipeline. A full render uses one Chromium lifecycle. */

import { readFileSync } from "node:fs";
import type { Browser } from "puppeteer";
import { baseline } from "./baseline.js";
import { normalize, type Canvas } from "./canvas.js";
import { visualProblems } from "./diagnostics.js";
import { reanchor } from "./edges.js";
import { lint, problem } from "./lint.js";
import { paint, parseMermaid, withBrowserSession } from "./paint.js";
import { applyPresentation, minimumFontSize } from "./presentation.js";
import { replay } from "./replay.js";
import { readLog } from "./store.js";
import { applyTheme, themeBackground } from "./themes.js";
import type {
  FrameStatus,
  Layout,
  Op,
  Presentation,
  Problem,
  StraightedgeStatus,
  ThemeName,
  VisualMeasurements,
} from "./types.js";

export interface ResolveResult {
  layout: Layout;
  canvas: Canvas;
  naturalCanvas: Canvas;
  warnings: string[];
  problems: Problem[];
  presentation: Presentation;
  theme?: ThemeName;
  frame: FrameStatus;
}

export interface RenderResult extends ResolveResult {
  status: StraightedgeStatus;
  svg: string;
  png: Buffer;
  visual: VisualMeasurements;
}

export async function render(sourcePath: string, browser?: Browser): Promise<RenderResult> {
  return renderWithOps(sourcePath, [...readLog(sourcePath).ops], browser);
}

export async function renderWithOps(sourcePath: string, ops: Op[], browser?: Browser): Promise<RenderResult> {
  if (!browser) return withBrowserSession((active) => renderWithOps(sourcePath, ops, active));
  const resolved = await resolveWithOps(sourcePath, ops, browser);
  const source = readSource(sourcePath);
  const painted = await paint(source, resolved.layout, resolved.canvas, browser);
  const visual = visualProblems(
    resolved.layout,
    painted.visual,
    resolved.frame,
    minimumFontSize(resolved.presentation),
  );
  const problems = [...resolved.problems, ...visual];
  return {
    ...resolved,
    ...painted,
    problems,
    status: statusOf(resolved.warnings, problems),
  };
}

/** Geometry inspection is intentionally not publication certification; check uses render(). */
export async function resolve(sourcePath: string, browser?: Browser): Promise<ResolveResult> {
  return resolveWithOps(sourcePath, [...readLog(sourcePath).ops], browser);
}

export async function resolveWithOps(
  sourcePath: string,
  ops: Op[],
  browser?: Browser,
): Promise<ResolveResult> {
  const source = readSource(sourcePath);
  const data = await parseMermaid(source, browser);
  const base = await baseline(data);
  const replayed = replay(base, ops);
  const routed = reanchor(replayed.layout, replayed.moved, replayed.rerouteEdges);
  const normalized = normalize(routed);
  const themed = applyTheme(normalized.layout, replayed.theme);
  const presented = applyPresentation(
    normalized.canvas,
    replayed.presentation,
    themeBackground(replayed.theme),
    themeFontSize(themed),
  );
  const staleProblems = replayed.warnings.map((warning) => ({
    ...problem("stale_operation", "warning", warning),
    suggestedOps: [],
  }));
  return {
    layout: themed,
    canvas: presented.canvas,
    naturalCanvas: normalized.canvas,
    warnings: replayed.warnings,
    problems: [...lint(themed), ...staleProblems],
    presentation: replayed.presentation,
    ...(replayed.theme === undefined ? {} : { theme: replayed.theme }),
    frame: presented.frame,
  };
}

export function statusOf(warnings: string[], problems: Problem[]): StraightedgeStatus {
  if (problems.some((candidate) => candidate.severity === "error")) return "failed";
  if (warnings.length > 0 || problems.some((candidate) => candidate.severity === "warning")) return "review";
  return "clean";
}

export function readSource(sourcePath: string): string {
  if (!sourcePath.endsWith(".mmd")) throw new Error("diagram source must end in .mmd");
  const source = readFileSync(sourcePath, "utf8");
  if (/^\s*subgraph\b/m.test(source)) throw new Error("Straightedge does not support subgraphs yet");
  return source;
}

function themeFontSize(layout: Layout): number {
  const sizes = Object.values(layout.nodes)
    .map((node) => node.style?.fontSize)
    .filter((size): size is number => size !== undefined);
  return sizes.length > 0 ? Math.min(...sizes) : 16;
}
