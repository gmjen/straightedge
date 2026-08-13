import type { RenderResult, ResolveResult } from "./render.js";

export function structuredResult(result: RenderResult | ResolveResult) {
  return {
    ...(hasStatus(result) ? { status: result.status } : {}),
    canvas: result.canvas,
    naturalCanvas: result.naturalCanvas,
    frame: result.frame,
    check: result.check,
    sourceDirection: result.sourceDirection,
    presentation: result.presentation,
    ...(result.theme === undefined ? {} : { theme: result.theme }),
    nodes: Object.values(result.layout.nodes),
    edges: result.layout.edges,
    warnings: result.warnings,
    problems: result.problems,
    trace: result.trace,
  };
}

function hasStatus(result: RenderResult | ResolveResult): result is RenderResult {
  return "status" in result;
}
