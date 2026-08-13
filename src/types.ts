/** Shared domain types. Geometry remains CSS pixels with top-left node origins. */

export interface Point {
  x: number;
  y: number;
}

export interface Bounds extends Point {
  width: number;
  height: number;
}

export type NodeShape =
  | "rect"
  | "round"
  | "stadium"
  | "circle"
  | "diamond"
  | "cylinder"
  | "hexagon";

export type ThemeRole = "default" | "primary" | "secondary" | "critical" | "muted";

export interface NodeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  textColor?: string;
  fontWeight?: string | number;
  fontFamily?: string;
  fontSize?: number;
  role?: ThemeRole;
}

export interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: NodeShape;
  style?: NodeStyle;
}

export interface Edge {
  id: string;
  source: string;
  target: string;
  label?: string;
  points: Point[];
}

export interface Layout {
  nodes: Record<string, Node>;
  edges: Edge[];
}

export type Axis = "horizontal" | "vertical";
export type AlignEdge = "left" | "right" | "top" | "bottom" | "centerX" | "centerY";
export type Side = "above" | "below" | "left" | "right";
export type Dimension = "width" | "height" | "both";

export interface MoveNode {
  op: "move_node";
  node: string;
  dx: number;
  dy: number;
}

export interface ResizeNode {
  op: "resize_node";
  node: string;
  width?: number;
  height?: number;
}

export interface AlignNodes {
  op: "align_nodes";
  nodes: string[];
  edge: AlignEdge;
}

export interface DistributeNodes {
  op: "distribute_nodes";
  nodes: string[];
  axis: Axis;
  gap?: number;
  /** Omitted in legacy logs means current. New operations always persist this explicitly. */
  order?: "given" | "current";
}

export interface RowNodes {
  op: "row_nodes";
  nodes: string[];
  gap: number;
  align?: "top" | "center" | "bottom";
}

export interface StackNodes {
  op: "stack_nodes";
  nodes: string[];
  gap: number;
  align?: "left" | "center" | "right";
}

export interface EqualizeSize {
  op: "equalize_size";
  nodes: string[];
  dimension: Dimension;
  value?: number;
}

export interface PlaceRelative {
  op: "place_relative";
  node: string;
  reference: string;
  side: Side;
  gap: number;
  crossAxis?: "center" | "keep";
}

export interface SetNodeStyle {
  op: "set_node_style";
  node: string;
  style: NodeStyle;
}

export interface StyleNodes {
  op: "style_nodes";
  nodes: string[];
  style: NodeStyle;
}

export type PresentationPreset = "slides-16:9" | "slides-4:3" | "a4-portrait" | "readme-wide";
export type ThemeName = "executive-light" | "technical" | "monochrome";

export interface Presentation {
  preset?: PresentationPreset;
  width?: number;
  height?: number;
  padding?: number;
  minFontSize?: number;
  background?: string;
  transparent?: boolean;
  rasterScale?: number;
}

export interface SetPresentation {
  op: "set_presentation";
  presentation: Presentation;
}

export interface ApplyTheme {
  op: "apply_theme";
  theme: ThemeName;
}

export interface RerouteEdges {
  op: "reroute_edges";
  edges?: string[];
}

export type LayoutOp =
  | MoveNode
  | ResizeNode
  | AlignNodes
  | DistributeNodes
  | RowNodes
  | StackNodes
  | EqualizeSize
  | PlaceRelative
  | SetNodeStyle
  | StyleNodes;

export type Op = LayoutOp | SetPresentation | ApplyTheme | RerouteEdges;

export interface OpLogV1 {
  version: 1;
  ops: Array<Exclude<Op, SetPresentation | ApplyTheme | StyleNodes | RerouteEdges | RowNodes | StackNodes>>;
}

export interface OpLogV2 {
  version: 2;
  ops: Op[];
}

export interface OpLogV3 {
  version: 3;
  ops: Op[];
}

export type OpLog = OpLogV1 | OpLogV2 | OpLogV3;

export interface DiagramState {
  layout: Layout;
  presentation: Presentation;
  theme?: ThemeName;
}

export type ProblemSeverity = "warning" | "error";
export type ProblemKind =
  | "overlap"
  | "near_collision"
  | "edge_crosses_node"
  | "text_overflow"
  | "text_touches_boundary"
  | "edge_label_collision"
  | "obscured_arrowhead"
  | "outside_target_frame"
  | "minimum_font_size"
  | "stale_operation"
  | "runtime_unavailable"
  | "long_connector"
  | "excessive_dogleg"
  | "direction_contradiction"
  | "excessive_whitespace";

export interface ProblemSubjects {
  nodes?: string[];
  edges?: string[];
  labels?: string[];
  frame?: boolean;
}

export interface Problem {
  id: string;
  kind: ProblemKind;
  severity: ProblemSeverity;
  message: string;
  subjects: ProblemSubjects;
  /** Backwards-compatible convenience for v0.1 callers. */
  nodes: string[];
  evidence?: Record<string, string | number | boolean>;
  suggestedOps: Op[];
  safeToAutoApply: boolean;
}

export type LintProblem = Problem;
export type StraightedgeStatus = "clean" | "review" | "failed";

export interface FrameStatus {
  active: boolean;
  satisfied: boolean;
  width: number;
  height: number;
  contentScale: number;
  effectiveFontSize: number;
}

export interface VisualNodeMeasurement {
  id: string;
  shape: NodeShape;
  shapeBounds: Bounds;
  labelBounds: Bounds;
}

export interface VisualEdgeLabelMeasurement {
  edge: string;
  bounds: Bounds;
}

export interface VisualMeasurements {
  nodes: VisualNodeMeasurement[];
  edgeLabels: VisualEdgeLabelMeasurement[];
}

export type DiagnosticProfile = "geometry" | "presentation";

export interface CheckRun {
  name: string;
  status: "passed" | "warning" | "failed" | "skipped";
}

export interface CheckSummary {
  profile: DiagnosticProfile;
  completed: boolean;
  checks: CheckRun[];
  claim: string;
}

export interface ReplayTrace {
  index: number;
  op: Op;
  state: "effective" | "partially_overridden" | "overridden" | "skipped";
  changedNodes: string[];
  changedEdges: string[];
  notes: string[];
}
