/**
 * Small geometric predicates. No dependencies, no state.
 */

import type { Node, Point } from "./types.js";

export const right = (n: Node): number => n.x + n.width;
export const bottom = (n: Node): number => n.y + n.height;
export const centerX = (n: Node): number => n.x + n.width / 2;
export const centerY = (n: Node): number => n.y + n.height / 2;
export const center = (n: Node): Point => ({ x: centerX(n), y: centerY(n) });

/** True if the two node boxes share any area. Touching edges do not count. */
export function overlaps(a: Node, b: Node): boolean {
  return a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y;
}

/** Shortest gap between two boxes along either axis. Negative when they overlap. */
export function separation(a: Node, b: Node): number {
  const dx = Math.max(a.x - right(b), b.x - right(a));
  const dy = Math.max(a.y - bottom(b), b.y - bottom(a));
  return Math.max(dx, dy);
}

/** True if segment p→q passes through node n's box. Used by lint.ts. */
export function segmentHitsNode(p: Point, q: Point, n: Node): boolean {
  // Cohen–Sutherland style outcode rejection, then a cheap separating-axis test.
  const x0 = n.x;
  const y0 = n.y;
  const x1 = right(n);
  const y1 = bottom(n);

  if (Math.max(p.x, q.x) <= x0 || Math.min(p.x, q.x) >= x1) return false;
  if (Math.max(p.y, q.y) <= y0 || Math.min(p.y, q.y) >= y1) return false;

  // Both endpoints strictly on one side of the segment's line means no crossing.
  const side = (x: number, y: number) => (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x);
  const corners = [side(x0, y0), side(x1, y0), side(x1, y1), side(x0, y1)];
  return !(corners.every((c) => c > 0) || corners.every((c) => c < 0));
}

/**
 * Where the segment from a node's center toward `toward` leaves the node's box.
 * Used by edges.ts to clip a re-anchored straight edge to the node boundary.
 *
 * Circles and diamonds use their real analytic boundary. The remaining shapes
 * deliberately use their bounding rectangle until their Mermaid outlines are
 * represented precisely.
 */
export function boundaryPoint(n: Node, toward: Point): Point {
  const c = center(n);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;

  if (n.shape === "circle") {
    const denominator = Math.sqrt((dx * dx) / ((n.width / 2) ** 2) + (dy * dy) / ((n.height / 2) ** 2));
    return { x: c.x + dx / denominator, y: c.y + dy / denominator };
  }
  if (n.shape === "diamond") {
    const denominator = Math.abs(dx) / (n.width / 2) + Math.abs(dy) / (n.height / 2);
    return { x: c.x + dx / denominator, y: c.y + dy / denominator };
  }

  // Scale the direction vector until it hits the nearer of the two box edges.
  const tx = dx === 0 ? Infinity : n.width / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : n.height / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: c.x + dx * t, y: c.y + dy * t };
}
