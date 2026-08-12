/** Mermaid's measured layout data -> ELK -> our plain Layout. */

import ELK from "elkjs";
import type { ELK as ElkInstance, ElkExtendedEdge, ElkNode, ElkPoint } from "elkjs/lib/elk-api.js";
import type { Layout, NodeShape, Point } from "./types.js";

export const ELK_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": "48",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
};

export interface LayoutData {
  type: string;
  direction: string;
  nodes: Array<{
    id: string;
    label?: unknown;
    shape?: string;
    width?: number;
    height?: number;
    isGroup?: boolean;
    parentId?: string;
  }>;
  edges: Array<{ id: string; start?: string; end?: string; label?: unknown }>;
}

const directions: Record<string, string> = {
  TB: "DOWN",
  TD: "DOWN",
  BT: "UP",
  LR: "RIGHT",
  RL: "LEFT",
};

export async function baseline(data: LayoutData): Promise<Layout> {
  if (!data.type.startsWith("flowchart")) {
    throw new Error(`Straightedge only supports flowcharts, not ${data.type}`);
  }
  if (data.nodes.some((node) => node.isGroup || node.parentId)) {
    throw new Error("Straightedge does not support subgraphs yet");
  }

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      ...ELK_OPTIONS,
      "elk.direction": directions[data.direction] ?? "RIGHT",
    },
    children: data.nodes.map((node) => {
      if (!node.width || !node.height) {
        throw new Error(`Mermaid did not measure node "${node.id}"`);
      }
      return { id: node.id, width: node.width, height: node.height };
    }),
    edges: data.edges.map((edge) => {
      if (!edge.start || !edge.end) throw new Error(`Mermaid edge "${edge.id}" has no endpoints`);
      return { id: edge.id, sources: [edge.start], targets: [edge.end] };
    }),
  };

  const Elk = ELK as unknown as new () => ElkInstance;
  const resolved: ElkNode = await new Elk().layout(graph);
  const elkNodes = Object.fromEntries((resolved.children ?? []).map((node) => [node.id, node]));

  return {
    nodes: Object.fromEntries(
      data.nodes.map((node) => {
        const placed = elkNodes[node.id];
        if (!placed) throw new Error(`ELK did not return node "${node.id}"`);
        return [
          node.id,
          {
            id: node.id,
            label: labelOf(node.label, node.id),
            x: placed.x ?? 0,
            y: placed.y ?? 0,
            width: placed.width ?? node.width ?? 0,
            height: placed.height ?? node.height ?? 0,
            shape: shapeOf(node.shape),
          },
        ];
      }),
    ),
    edges: data.edges.map((edge) => {
      const laidOut = (resolved.edges ?? []).find((candidate) => candidate.id === edge.id);
      return {
        id: edge.id,
        source: edge.start!,
        target: edge.end!,
        ...(edge.label === undefined ? {} : { label: labelOf(edge.label, "") }),
        points: edgePoints(laidOut, elkNodes[edge.start!], elkNodes[edge.end!]),
      };
    }),
  };
}

function edgePoints(edge: ElkExtendedEdge | undefined, source?: ElkNode, target?: ElkNode): Point[] {
  const section = edge?.sections?.[0];
  if (section) return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
  return [centre(source), centre(target)];
}

function centre(node?: ElkNode): ElkPoint {
  return { x: (node?.x ?? 0) + (node?.width ?? 0) / 2, y: (node?.y ?? 0) + (node?.height ?? 0) / 2 };
}

function labelOf(label: unknown, fallback: string): string {
  if (typeof label === "string") return label;
  if (Array.isArray(label)) return label.join(" ");
  return fallback;
}

function shapeOf(shape?: string): NodeShape {
  if (shape?.includes("cylinder")) return "cylinder";
  if (shape?.includes("diamond") || shape === "question") return "diamond";
  if (shape?.includes("circle")) return "circle";
  if (shape?.includes("stadium")) return "stadium";
  if (shape?.includes("hexagon")) return "hexagon";
  if (shape?.includes("round")) return "round";
  return "rect";
}

// LIMITATION: ELK can return multiple sections for compound and hyper-edges. Straightedge
// rejects compounds and keeps the first section for all other edges.
