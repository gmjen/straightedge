import { problem } from "./lint.js";
import type {
  FrameStatus,
  Layout,
  Problem,
  VisualMeasurements,
  VisualNodeMeasurement,
} from "./types.js";

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
