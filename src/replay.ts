/**
 * The entire layout engine: fold the op log over the ELK baseline.
 *
 *     Layout = replay(Baseline, OpLog)
 *
 * There is no stored geometry anywhere in Straightedge. The baseline is
 * recomputed on every render and the ops are replayed from scratch, which is
 * what keeps this function pure and the whole system predictable.
 */

import { applyOp, movedNodeIds, nodeIdsIn } from "./ops.js";
import type { Layout, LayoutOp, Op, Presentation, ThemeName } from "./types.js";

export interface ReplayResult {
  layout: Layout;
  /** Human-readable notes about ops that were skipped. Surfaced to the agent. */
  warnings: string[];
  /** Nodes touched by at least one applied op. edges.ts needs this. */
  moved: Set<string>;
  presentation: Presentation;
  theme?: ThemeName;
  rerouteEdges: Set<string> | "all";
}

export function replay(baseline: Layout, ops: Op[]): ReplayResult {
  let layout = baseline;
  const warnings: string[] = [];
  const moved = new Set<string>();
  let presentation: Presentation = {};
  let theme: ThemeName | undefined;
  let rerouteEdges: Set<string> | "all" = new Set<string>();

  for (const [i, op] of ops.entries()) {
    const missing = nodeIdsIn(op).filter((id) => !layout.nodes[id]);
    if (missing.length > 0) {
      // This `continue` is the whole ID-drift story: a renamed or deleted node
      // costs you the ops that mentioned it and nothing else. Never let one
      // stale op invalidate the rest of someone's visual work.
      warnings.push(`op ${i} (${op.op}) skipped: no node ${missing.join(", ")}`);
      continue;
    }

    if (op.op === "set_presentation") {
      presentation = { ...presentation, ...op.presentation };
      continue;
    }
    if (op.op === "apply_theme") {
      theme = op.theme;
      continue;
    }
    if (op.op === "reroute_edges") {
      if (op.edges === undefined) rerouteEdges = "all";
      else if (rerouteEdges !== "all") rerouteEdges = new Set([...rerouteEdges, ...op.edges]);
      continue;
    }

    layout = applyOp(layout, op as LayoutOp);
    for (const id of movedNodeIds(op)) moved.add(id);
  }

  return {
    layout,
    warnings,
    moved,
    presentation,
    ...(theme === undefined ? {} : { theme }),
    rerouteEdges,
  };
}
