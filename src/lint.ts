/** Pure geometry diagnostics with stable, actionable problem records. */

import { overlaps, segmentHitsNode, separation } from "./geometry.js";
import type { Layout, Node, Problem, ProblemKind, ProblemSeverity } from "./types.js";

const MIN_GAP = 8;

export function lint(layout: Layout): Problem[] {
  const problems: Problem[] = [];
  const nodes = Object.values(layout.nodes);

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const gap = separation(a, b);
      if (overlaps(a, b)) {
        problems.push(problem("overlap", "error", `"${a.id}" and "${b.id}" overlap`, [a.id, b.id]));
      } else if (gap < MIN_GAP) {
        problems.push(problem(
          "near_collision",
          "warning",
          `"${a.id}" and "${b.id}" are ${gap.toFixed(0)}px apart`,
          [a.id, b.id],
          { gap, minimumGap: MIN_GAP },
        ));
      }
    }
  }

  for (const edge of layout.edges) {
    const beforeArrow = edge.points.at(-2);
    const arrow = edge.points.at(-1);
    if (!beforeArrow || !arrow || Math.hypot(arrow.x - beforeArrow.x, arrow.y - beforeArrow.y) < 6) {
      problems.push({
        ...problem(
          "obscured_arrowhead",
          "error",
          `edge ${edge.source}→${edge.target} has no visible final arrow segment`,
          [edge.source, edge.target],
        ),
        subjects: { nodes: [edge.source, edge.target], edges: [edge.id] },
        suggestedOps: [{ op: "reroute_edges", edges: [edge.id] }],
        safeToAutoApply: true,
      });
    }
    for (const node of nodes) {
      if (node.id === edge.source || node.id === edge.target) continue;
      if (crossesNode(edge.points, node)) {
        problems.push({
          ...problem(
            "edge_crosses_node",
            "error",
            `edge ${edge.source}→${edge.target} passes through "${node.id}"`,
            [edge.source, edge.target, node.id],
          ),
          subjects: { nodes: [edge.source, edge.target, node.id], edges: [edge.id] },
          suggestedOps: [{ op: "reroute_edges", edges: [edge.id] }],
          safeToAutoApply: true,
        });
      }
    }
  }

  return problems;
}

export function problem(
  kind: ProblemKind,
  severity: ProblemSeverity,
  message: string,
  nodes: string[] = [],
  evidence?: Record<string, string | number | boolean>,
): Problem {
  const key = [kind, ...nodes].join(":");
  return {
    id: stableId(key),
    kind,
    severity,
    message,
    subjects: nodes.length > 0 ? { nodes } : {},
    nodes,
    ...(evidence === undefined ? {} : { evidence }),
    suggestedOps: [],
    safeToAutoApply: false,
  };
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.split(":", 1)[0]}-${(hash >>> 0).toString(36)}`;
}

function crossesNode(points: { x: number; y: number }[], node: Node): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentHitsNode(points[i]!, points[i + 1]!, node)) return true;
  }
  return false;
}
