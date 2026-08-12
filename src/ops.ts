/**
 * Pure layout operations. This is the heart of the project.
 *
 * Every op is a pure function `(Layout, Params) => Layout`. No classes, no
 * mutation, no I/O, no Mermaid, no ELK, no browser. That makes this file
 * unit-testable in milliseconds, which is the most valuable structural
 * property Straightedge has. Please keep it that way.
 */

import { bottom, centerX, centerY, right } from "./geometry.js";
import type {
  AlignEdge,
  AlignNodes,
  DistributeNodes,
  EqualizeSize,
  Layout,
  LayoutOp,
  MoveNode,
  Node,
  Op,
  PlaceRelative,
  ResizeNode,
  SetNodeStyle,
  StyleNodes,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function get(layout: Layout, id: string): Node {
  const n = layout.nodes[id];
  if (!n) throw new Error(`no node "${id}" in this diagram`);
  return n;
}

function withNodes(layout: Layout, updates: Record<string, Node>): Layout {
  return { ...layout, nodes: { ...layout.nodes, ...updates } };
}

/**
 * Resize about the node's center rather than its top-left corner, because
 * "make this box wider" means growing outward, not dragging one corner.
 */
function resized(n: Node, width: number, height: number): Node {
  const cx = centerX(n);
  const cy = centerY(n);
  return { ...n, width, height, x: cx - width / 2, y: cy - height / 2 };
}

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

export function moveNode(layout: Layout, p: MoveNode): Layout {
  const n = get(layout, p.node);
  return withNodes(layout, { [n.id]: { ...n, x: n.x + p.dx, y: n.y + p.dy } });
}

export function resizeNode(layout: Layout, p: ResizeNode): Layout {
  const n = get(layout, p.node);
  return withNodes(layout, { [n.id]: resized(n, p.width ?? n.width, p.height ?? n.height) });
}

/** nodes[0] anchors and does not move. See SPEC.md §7 for why first-wins. */
export function alignNodes(layout: Layout, p: AlignNodes): Layout {
  const [anchorId, ...rest] = p.nodes;
  if (!anchorId) return layout;

  const anchor = get(layout, anchorId);
  const updates: Record<string, Node> = {};
  for (const id of rest) {
    updates[id] = alignOne(get(layout, id), anchor, p.edge);
  }
  return withNodes(layout, updates);
}

function alignOne(n: Node, a: Node, edge: AlignEdge): Node {
  switch (edge) {
    case "left":
      return { ...n, x: a.x };
    case "right":
      return { ...n, x: right(a) - n.width };
    case "centerX":
      return { ...n, x: centerX(a) - n.width / 2 };
    case "top":
      return { ...n, y: a.y };
    case "bottom":
      return { ...n, y: bottom(a) - n.height };
    case "centerY":
      return { ...n, y: centerY(a) - n.height / 2 };
  }
}

export function distributeNodes(layout: Layout, p: DistributeNodes): Layout {
  const horizontal = p.axis === "horizontal";
  const size = (n: Node) => (horizontal ? n.width : n.height);
  const lead = (n: Node) => (horizontal ? n.x : n.y);

  // Sorted by current position, not list order — the agent shouldn't need to
  // know the existing arrangement to space things evenly.
  const nodes = p.nodes.map((id) => get(layout, id)).sort((m, n) => lead(m) - lead(n));
  if (nodes.length < 2) return layout;

  let gap = p.gap;
  if (gap === undefined) {
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const span = lead(last) + size(last) - lead(first);
    const occupied = nodes.reduce((sum, n) => sum + size(n), 0);
    // LIMITATION: goes negative when the nodes don't fit in their own span, and
    // they will overlap. Deliberate — silently ignoring the instruction is worse
    // than an obviously wrong picture, and lint.ts reports it.
    gap = (span - occupied) / (nodes.length - 1);
  }

  const updates: Record<string, Node> = {};
  let cursor = lead(nodes[0]!) + size(nodes[0]!) + gap;
  for (const n of nodes.slice(1)) {
    updates[n.id] = horizontal ? { ...n, x: cursor } : { ...n, y: cursor };
    cursor += size(n) + gap;
  }
  return withNodes(layout, updates);
}

export function equalizeSize(layout: Layout, p: EqualizeSize): Layout {
  const nodes = p.nodes.map((id) => get(layout, id));
  if (nodes.length === 0) return layout;

  const wants = (d: "width" | "height") => p.dimension === "both" || p.dimension === d;
  const width = wants("width") ? (p.value ?? Math.max(...nodes.map((n) => n.width))) : undefined;
  const height = wants("height") ? (p.value ?? Math.max(...nodes.map((n) => n.height))) : undefined;

  const updates: Record<string, Node> = {};
  for (const n of nodes) {
    updates[n.id] = resized(n, width ?? n.width, height ?? n.height);
  }
  return withNodes(layout, updates);
}

export function placeRelative(layout: Layout, p: PlaceRelative): Layout {
  const n = get(layout, p.node);
  const ref = get(layout, p.reference);
  const centered = (p.crossAxis ?? "center") === "center";

  const next: Node = { ...n };
  switch (p.side) {
    case "below":
      next.y = bottom(ref) + p.gap;
      if (centered) next.x = centerX(ref) - n.width / 2;
      break;
    case "above":
      next.y = ref.y - p.gap - n.height;
      if (centered) next.x = centerX(ref) - n.width / 2;
      break;
    case "right":
      next.x = right(ref) + p.gap;
      if (centered) next.y = centerY(ref) - n.height / 2;
      break;
    case "left":
      next.x = ref.x - p.gap - n.width;
      if (centered) next.y = centerY(ref) - n.height / 2;
      break;
  }
  return withNodes(layout, { [n.id]: next });
}

/** The one non-geometric op. Applied at paint time; replay just records it. */
export function setNodeStyle(layout: Layout, p: SetNodeStyle): Layout {
  const n = get(layout, p.node);
  return withNodes(layout, { [n.id]: { ...n, style: { ...n.style, ...p.style } } });
}

export function styleNodes(layout: Layout, p: StyleNodes): Layout {
  const updates: Record<string, Node> = {};
  for (const id of p.nodes) {
    const n = get(layout, id);
    updates[id] = { ...n, style: { ...n.style, ...p.style } };
  }
  return withNodes(layout, updates);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function applyOp(layout: Layout, op: LayoutOp): Layout {
  switch (op.op) {
    case "move_node":
      return moveNode(layout, op);
    case "resize_node":
      return resizeNode(layout, op);
    case "align_nodes":
      return alignNodes(layout, op);
    case "distribute_nodes":
      return distributeNodes(layout, op);
    case "equalize_size":
      return equalizeSize(layout, op);
    case "place_relative":
      return placeRelative(layout, op);
    case "set_node_style":
      return setNodeStyle(layout, op);
    case "style_nodes":
      return styleNodes(layout, op);
  }
}

/** Every node id an op mentions. Used by replay.ts to detect stale ops. */
export function nodeIdsIn(op: Op): string[] {
  switch (op.op) {
    case "move_node":
    case "resize_node":
    case "set_node_style":
      return [op.node];
    case "align_nodes":
    case "distribute_nodes":
    case "equalize_size":
      return op.nodes;
    case "place_relative":
      return [op.node, op.reference];
    case "style_nodes":
      return op.nodes;
    case "set_presentation":
    case "apply_theme":
      return [];
    case "reroute_edges":
      return [];
  }
}

/**
 * Node ids an op may have moved or resized. Used by edges.ts to decide which
 * edges lose their ELK routing.
 *
 * LIMITATION: over-reports for distribute_nodes, where the first node by
 * position doesn't actually move but we can't tell which that is without the
 * layout. The cost is one extra edge re-anchored to a straight line. Fine.
 */
export function movedNodeIds(op: Op): string[] {
  switch (op.op) {
    case "set_node_style":
    case "style_nodes":
    case "set_presentation":
    case "apply_theme":
    case "reroute_edges":
      return [];
    case "align_nodes":
      return op.nodes.slice(1); // the anchor stays put
    case "place_relative":
      return [op.node]; // the reference stays put
    default:
      return nodeIdsIn(op);
  }
}
