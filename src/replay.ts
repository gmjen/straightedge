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
import type { Layout, LayoutOp, Op, Presentation, ReplayTrace, ThemeName } from "./types.js";

export interface ReplayResult {
  layout: Layout;
  /** Human-readable notes about ops that were skipped. Surfaced to the agent. */
  warnings: string[];
  /** Nodes touched by at least one applied op. edges.ts needs this. */
  moved: Set<string>;
  presentation: Presentation;
  theme?: ThemeName;
  rerouteEdges: Set<string> | "all";
  trace: ReplayTrace[];
}

export function replay(baseline: Layout, ops: Op[]): ReplayResult {
  let layout = baseline;
  const warnings: string[] = [];
  const moved = new Set<string>();
  let presentation: Presentation = {};
  let theme: ThemeName | undefined;
  let rerouteEdges: Set<string> | "all" = new Set<string>();
  const trace: ReplayTrace[] = [];
  const traceTokens: Array<Set<string>> = [];

  for (const [i, op] of ops.entries()) {
    const missing = nodeIdsIn(op).filter((id) => !layout.nodes[id]);
    if (missing.length > 0) {
      // This `continue` is the whole ID-drift story: a renamed or deleted node
      // costs you the ops that mentioned it and nothing else. Never let one
      // stale op invalidate the rest of someone's visual work.
      warnings.push(`op ${i} (${op.op}) skipped: no node ${missing.join(", ")}`);
      trace.push({ index: i, op, state: "skipped", changedNodes: [], changedEdges: [], notes: [`missing: ${missing.join(", ")}`] });
      traceTokens.push(new Set());
      continue;
    }

    const tokens = effectTokens(op, layout);
    const overriding = overrideTokens(op, layout);
    for (let prior = 0; prior < trace.length; prior++) {
      if (trace[prior]!.state === "skipped") continue;
      const priorTokens = traceTokens[prior]!;
      const overridden = [...priorTokens].filter((token) => overriding.has(token));
      if (overridden.length === 0) continue;
      for (const token of overridden) priorTokens.delete(token);
      trace[prior]!.state = priorTokens.size === 0 ? "overridden" : "partially_overridden";
      trace[prior]!.notes.push(`superseded by op ${i}: ${overridden.join(", ")}`);
    }
    const before = layout;

    if (op.op === "set_presentation") {
      presentation = { ...presentation, ...op.presentation };
      trace.push({ index: i, op, state: "effective", changedNodes: [], changedEdges: [], notes: [] });
      traceTokens.push(tokens);
      continue;
    }
    if (op.op === "apply_theme") {
      theme = op.theme;
      trace.push({ index: i, op, state: "effective", changedNodes: [], changedEdges: [], notes: [] });
      traceTokens.push(tokens);
      continue;
    }
    if (op.op === "reroute_edges") {
      if (op.edges === undefined) rerouteEdges = "all";
      else if (rerouteEdges !== "all") rerouteEdges = new Set([...rerouteEdges, ...op.edges]);
      trace.push({ index: i, op, state: "effective", changedNodes: [], changedEdges: op.edges ?? [], notes: [] });
      traceTokens.push(tokens);
      continue;
    }

    layout = applyOp(layout, op as LayoutOp);
    for (const id of movedNodeIds(op)) moved.add(id);
    trace.push({
      index: i,
      op,
      state: "effective",
      changedNodes: changedNodes(before, layout),
      changedEdges: [],
      notes: [],
    });
    traceTokens.push(tokens);
  }

  return {
    layout,
    warnings,
    moved,
    presentation,
    ...(theme === undefined ? {} : { theme }),
    rerouteEdges,
    trace,
  };
}

function changedNodes(before: Layout, after: Layout): string[] {
  return Object.keys(after.nodes).filter((id) => JSON.stringify(before.nodes[id]) !== JSON.stringify(after.nodes[id]));
}

function effectTokens(op: Op, layout: Layout): Set<string> {
  const tokens = new Set<string>();
  const add = (ids: string[], properties: string[]) => {
    for (const id of ids) for (const property of properties) tokens.add(`node:${id}:${property}`);
  };
  switch (op.op) {
    case "move_node": add([op.node], ["x", "y"]); break;
    case "resize_node": {
      const circle = layout.nodes[op.node]?.shape === "circle";
      add([op.node], circle ? ["width", "height"] : [op.width === undefined ? "" : "width", op.height === undefined ? "" : "height"].filter(Boolean));
      break;
    }
    case "align_nodes": add(op.nodes.slice(1), [new Set(["left", "right", "centerX"]).has(op.edge) ? "x" : "y"]); break;
    case "distribute_nodes": add(op.nodes.slice(1), [op.axis === "horizontal" ? "x" : "y"]); break;
    case "row_nodes": add(op.nodes, ["x", "y"]); break;
    case "stack_nodes": add(op.nodes, ["x", "y"]); break;
    case "equalize_size": add(op.nodes, op.dimension === "both" ? ["width", "height"] : [op.dimension]); break;
    case "place_relative": add([op.node], ["x", "y"]); break;
    case "set_node_style": add([op.node], Object.keys(op.style).map((key) => `style.${key}`)); break;
    case "style_nodes": add(op.nodes, Object.keys(op.style).map((key) => `style.${key}`)); break;
    case "set_presentation": for (const key of Object.keys(op.presentation)) tokens.add(`presentation:${key}`); break;
    case "apply_theme": tokens.add("theme"); break;
    case "reroute_edges": for (const id of op.edges ?? ["*"]) tokens.add(`edge:${id}:route`); break;
  }
  return tokens;
}

/** Relative movement accumulates; other setters replace matching prior intent. */
function overrideTokens(op: Op, layout: Layout): Set<string> {
  if (op.op === "move_node" || op.op === "reroute_edges") return new Set();
  return effectTokens(op, layout);
}
