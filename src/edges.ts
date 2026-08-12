/** Shape-aware endpoint clipping and bounded obstacle-aware routing. */

import { boundaryPoint, center, segmentHitsNode } from "./geometry.js";
import type { Edge, Layout, Node, Point } from "./types.js";

const CLEARANCE = 16;
const BEND_COST = 12;

export function reanchor(
  layout: Layout,
  moved: Set<string>,
  requested: Set<string> | "all" = new Set<string>(),
): Layout {
  if (moved.size === 0 && requested !== "all" && requested.size === 0) return layout;

  return {
    ...layout,
    edges: layout.edges.map((edge) => {
      const selected = requested === "all" || requested.has(edge.id);
      if (!selected && !moved.has(edge.source) && !moved.has(edge.target)) return edge;
      return routeEdge(layout, edge);
    }),
  };
}

export function routeEdge(layout: Layout, edge: Edge): Edge {
  const source = layout.nodes[edge.source];
  const target = layout.nodes[edge.target];
  if (!source || !target) return edge;

  const start = center(source);
  const end = center(target);
  const obstacles = Object.values(layout.nodes).filter(
    (node) => node.id !== source.id && node.id !== target.id,
  );
  const candidates: Point[][] = [
    [start, end],
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
  ];

  for (const obstacle of obstacles) {
    for (const y of [obstacle.y - CLEARANCE, obstacle.y + obstacle.height + CLEARANCE]) {
      candidates.push([start, { x: start.x, y }, { x: end.x, y }, end]);
    }
    for (const x of [obstacle.x - CLEARANCE, obstacle.x + obstacle.width + CLEARANCE]) {
      candidates.push([start, { x, y: start.y }, { x, y: end.y }, end]);
    }
  }

  const viable = candidates
    .map(simplify)
    .filter((points) => clear(points, obstacles))
    .sort((a, b) => cost(a) - cost(b));
  const selected = viable[0] ?? [start, end];
  const clipped = clip(selected, source, target);
  return { ...edge, points: clipped };
}

function clear(points: Point[], obstacles: Node[]): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (const obstacle of obstacles) {
      const inflated: Node = {
        ...obstacle,
        x: obstacle.x - CLEARANCE,
        y: obstacle.y - CLEARANCE,
        width: obstacle.width + CLEARANCE * 2,
        height: obstacle.height + CLEARANCE * 2,
      };
      if (segmentHitsNode(a, b, inflated)) return false;
    }
  }
  return true;
}

function clip(points: Point[], source: Node, target: Node): Point[] {
  if (points.length < 2) return points;
  const firstDirection = points[1]!;
  const lastDirection = points[points.length - 2]!;
  return [
    boundaryPoint(source, firstDirection),
    ...points.slice(1, -1),
    boundaryPoint(target, lastDirection),
  ];
}

function simplify(points: Point[]): Point[] {
  const unique = points.filter(
    (point, index) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y,
  );
  return unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true;
    const before = unique[index - 1]!;
    const after = unique[index + 1]!;
    return !((before.x === point.x && point.x === after.x) || (before.y === point.y && point.y === after.y));
  });
}

function cost(points: Point[]): number {
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    length += Math.abs(points[i + 1]!.x - points[i]!.x) + Math.abs(points[i + 1]!.y - points[i]!.y);
  }
  return length + Math.max(0, points.length - 2) * BEND_COST;
}
