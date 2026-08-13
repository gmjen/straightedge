import { problem } from "./lint.js";
import type {
  DiagnosticProfile,
  FrameStatus,
  Layout,
  Problem,
  CheckSummary,
  VisualMeasurements,
  VisualNodeMeasurement,
} from "./types.js";
import type { Canvas } from "./canvas.js";

const LABEL_PADDING = 8;
const TOUCH_TOLERANCE = 1.5;

export function visualProblems(
  layout: Layout,
  visual: VisualMeasurements,
  frame: FrameStatus,
  minFontSize: number,
): Problem[] {
  const problems: Problem[] = [];
  for (const measurement of visual.nodes) {
    const node = layout.nodes[measurement.id];
    if (!node) continue;
    const fit = labelFit(measurement);
    if (!fit.fits) {
      const suggested = resizeSuggestion(measurement);
      problems.push({
        ...problem(
          "text_overflow",
          "error",
          `label for "${node.id}" does not fit inside its ${node.shape}`,
          [node.id],
          {
            labelWidth: measurement.labelBounds.width,
            labelHeight: measurement.labelBounds.height,
            shapeWidth: measurement.shapeBounds.width,
            shapeHeight: measurement.shapeBounds.height,
            minimumWidth: suggested.width,
            minimumHeight: suggested.height,
          },
        ),
        suggestedOps: [{ op: "resize_node", node: node.id, ...suggested }],
        safeToAutoApply: true,
      });
    } else if (fit.padding < LABEL_PADDING - TOUCH_TOLERANCE) {
      const suggested = resizeSuggestion(measurement);
      problems.push({
        ...problem(
          "text_touches_boundary",
          "warning",
          `label for "${node.id}" has only ${Math.max(0, fit.padding).toFixed(1)}px of shape padding`,
          [node.id],
          { padding: fit.padding, minimumPadding: LABEL_PADDING },
        ),
        suggestedOps: [{ op: "resize_node", node: node.id, ...suggested }],
        safeToAutoApply: true,
      });
    }
  }

  for (const label of visual.edgeLabels) {
    for (const measuredNode of visual.nodes) {
      const node = layout.nodes[measuredNode.id];
      if (node && rectsOverlap(label.bounds, measuredNode.shapeBounds)) {
        problems.push({
          ...problem(
            "edge_label_collision",
            "warning",
            `label for edge "${label.edge}" overlaps "${node.id}"`,
            [node.id],
          ),
          subjects: { nodes: [node.id], edges: [label.edge], labels: [label.edge] },
        });
      }
    }
  }

  if (frame.active && !frame.satisfied) {
    problems.push({
      ...problem(
        "minimum_font_size",
        "error",
        `target frame would reduce text to ${frame.effectiveFontSize.toFixed(1)}px, below ${minFontSize}px`,
        [],
        { effectiveFontSize: frame.effectiveFontSize, minimumFontSize: minFontSize },
      ),
      subjects: { frame: true },
    });
  }
  return problems;
}

export function presentationProblems(
  layout: Layout,
  naturalCanvas: Canvas,
  finalCanvas: Canvas,
  direction: string,
  touchedNodes: Set<string> = new Set(Object.keys(layout.nodes)),
): Problem[] {
  const problems: Problem[] = [];
  const widths = Object.values(layout.nodes).map((node) => node.width).sort((a, b) => a - b);
  const medianWidth = widths[Math.floor(widths.length / 2)] ?? 0;
  const diagonal = Math.hypot(naturalCanvas.width, naturalCanvas.height);

  for (const edge of layout.edges) {
    const length = pathLength(edge.points);
    const direct = edge.points.length < 2 ? 0 : manhattan(edge.points[0]!, edge.points.at(-1)!);
    const bends = Math.max(0, edge.points.length - 2);
    if (length > Math.max(medianWidth * 4, diagonal * 0.45)) {
      problems.push(advisory("long_connector", `edge ${edge.source}→${edge.target} is unusually long`, edge.id, {
        routedLength: length,
        medianNodeWidth: medianWidth,
        canvasDiagonal: diagonal,
      }));
    }
    if (bends > 3 || (direct > 0 && length / direct > 1.75)) {
      problems.push(advisory("excessive_dogleg", `edge ${edge.source}→${edge.target} has an excessive dogleg`, edge.id, {
        bends,
        routedLength: length,
        directLength: direct,
      }));
    }
  }

  const editedEdges = layout.edges.filter((edge) => touchedNodes.has(edge.source) || touchedNodes.has(edge.target));
  const contradicted = editedEdges.filter((edge) => contradictsDirection(layout, edge.source, edge.target, direction));
  if (editedEdges.length > 0 && contradicted.length > editedEdges.length / 2) {
    const item = problem(
      "direction_contradiction",
      "warning",
      `${contradicted.length} of ${editedEdges.length} edited connections contradict Mermaid direction ${direction}`,
      [...new Set(contradicted.flatMap((edge) => [edge.source, edge.target]))],
      { direction, contradictedEdges: contradicted.length, totalEdges: editedEdges.length },
    );
    item.subjects.edges = contradicted.map((edge) => edge.id);
    problems.push(item);
  }

  if (finalCanvas.viewBoxWidth !== undefined && finalCanvas.viewBoxHeight !== undefined) {
    const contentArea = Object.values(layout.nodes).reduce((total, node) => total + node.width * node.height, 0);
    const occupancy = contentArea / (finalCanvas.viewBoxWidth * finalCanvas.viewBoxHeight);
    if (occupancy < 0.18) {
      const item = problem(
        "excessive_whitespace",
        "warning",
        `diagram content occupies ${(occupancy * 100).toFixed(1)}% of the target frame`,
        [],
        { occupancy, minimumOccupancy: 0.18 },
      );
      item.subjects = { frame: true };
      problems.push(item);
    }
  }
  return problems;
}

export function checkSummary(profile: DiagnosticProfile, problems: Problem[], completed = true): CheckSummary {
  const groups: Array<[string, Problem["kind"][]]> = [
    ["node geometry", ["overlap", "near_collision"]],
    ["labels and shape containment", ["text_overflow", "text_touches_boundary", "edge_label_collision"]],
    ["edge geometry", ["edge_crosses_node", "obscured_arrowhead"]],
    ["operation replay", ["stale_operation"]],
    ["required runtime", ["runtime_unavailable"]],
    ["target frame", ["outside_target_frame", "minimum_font_size"]],
  ];
  if (profile === "presentation") groups.push(["presentation guidance", ["long_connector", "excessive_dogleg", "direction_contradiction", "excessive_whitespace"]]);
  const checks: CheckSummary["checks"] = groups.map(([name, kinds]) => {
    const found = problems.filter((candidate) => kinds.includes(candidate.kind));
    return {
      name,
      status: found.some((candidate) => candidate.severity === "error")
        ? "failed" as const
        : found.length > 0
          ? "warning" as const
          : "passed" as const,
    };
  });
  if (!completed) checks.push({ name: "browser visual inspection", status: "skipped" });
  return {
    profile,
    completed,
    checks,
    claim: !completed
      ? "Required checks did not complete."
      : problems.some((candidate) => candidate.severity === "error")
        ? "Blocking problems were detected by the active checks."
        : "No blocking problems were detected by the active checks.",
  };
}

function advisory(kind: "long_connector" | "excessive_dogleg", message: string, edge: string, evidence: Record<string, number>): Problem {
  const item = problem(kind, "warning", message, [], evidence);
  item.subjects = { edges: [edge] };
  return item;
}

function pathLength(points: Array<{ x: number; y: number }>): number {
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) length += manhattan(points[i]!, points[i + 1]!);
  return length;
}

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function contradictsDirection(layout: Layout, sourceId: string, targetId: string, direction: string): boolean {
  const source = layout.nodes[sourceId];
  const target = layout.nodes[targetId];
  if (!source || !target) return false;
  const dx = target.x + target.width / 2 - (source.x + source.width / 2);
  const dy = target.y + target.height / 2 - (source.y + source.height / 2);
  if (direction === "TB" || direction === "TD") return dy <= 0 || Math.abs(dx) > Math.abs(dy);
  if (direction === "BT") return dy >= 0 || Math.abs(dx) > Math.abs(dy);
  if (direction === "RL") return dx >= 0 || Math.abs(dy) > Math.abs(dx);
  return dx <= 0 || Math.abs(dy) > Math.abs(dx);
}

function labelFit(measurement: VisualNodeMeasurement): { fits: boolean; padding: number } {
  const shape = measurement.shapeBounds;
  const label = measurement.labelBounds;
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  const halfWidth = label.width / 2;
  const halfHeight = label.height / 2;
  const rx = shape.width / 2;
  const ry = shape.height / 2;
  const dx = Math.abs(label.x + label.width / 2 - cx) + halfWidth;
  const dy = Math.abs(label.y + label.height / 2 - cy) + halfHeight;

  switch (measurement.shape) {
    case "circle": {
      const radial = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
      return { fits: radial <= 1, padding: Math.min(rx, ry) * (1 - radial) };
    }
    case "diamond": {
      const radial = dx / rx + dy / ry;
      return { fits: radial <= 1, padding: Math.min(rx, ry) * (1 - radial) };
    }
    case "hexagon": {
      const horizontalInset = shape.width * 0.2;
      const padding = Math.min(rx - dx - horizontalInset, ry - dy);
      return { fits: padding >= 0, padding };
    }
    default: {
      const padding = Math.min(rx - dx, ry - dy);
      return { fits: padding >= 0, padding };
    }
  }
}

function resizeSuggestion(measurement: VisualNodeMeasurement): { width: number; height: number } {
  const labelWidth = measurement.labelBounds.width;
  const labelHeight = measurement.labelBounds.height;
  switch (measurement.shape) {
    case "circle": {
      const diameter = 2 * (Math.hypot(labelWidth / 2, labelHeight / 2) + LABEL_PADDING);
      return { width: diameter, height: diameter };
    }
    case "diamond": {
      const size = 2 * (labelWidth / 2 + labelHeight / 2 + LABEL_PADDING);
      return { width: size, height: size };
    }
    case "hexagon":
      return { width: (labelWidth + LABEL_PADDING * 2) / 0.6, height: labelHeight + LABEL_PADDING * 2 };
    default:
      return { width: labelWidth + LABEL_PADDING * 2, height: labelHeight + LABEL_PADDING * 2 };
  }
}

function rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
