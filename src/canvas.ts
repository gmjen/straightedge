/**
 * Final pass: slide everything into positive coordinates and size the canvas.
 *
 * Nodes legitimately hold negative coordinates mid-replay (a centered resize can
 * push the leftmost node past the origin). That's fine, and it's normalized here,
 * once, at the end.
 */

import { bottom, right } from "./geometry.js";
import type { Layout } from "./types.js";

export const PADDING = 32;

export interface Canvas {
  width: number;
  height: number;
  /** Logical SVG viewport. When omitted it equals width/height. */
  viewBoxWidth?: number;
  viewBoxHeight?: number;
  viewBoxX?: number;
  viewBoxY?: number;
  background?: string;
  transparent?: boolean;
  rasterScale?: number;
}

export function normalize(layout: Layout): { layout: Layout; canvas: Canvas } {
  const nodes = Object.values(layout.nodes);
  if (nodes.length === 0) return { layout, canvas: { width: 0, height: 0 } };

  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of nodes) {
    xs.push(n.x, right(n));
    ys.push(n.y, bottom(n));
  }
  for (const e of layout.edges) {
    for (const p of e.points) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }

  const dx = PADDING - Math.min(...xs);
  const dy = PADDING - Math.min(...ys);

  return {
    layout: {
      nodes: Object.fromEntries(nodes.map((n) => [n.id, { ...n, x: n.x + dx, y: n.y + dy }])),
      edges: layout.edges.map((e) => ({
        ...e,
        points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      })),
    },
    canvas: {
      width: Math.max(...xs) + dx + PADDING,
      height: Math.max(...ys) + dy + PADDING,
    },
  };
}
