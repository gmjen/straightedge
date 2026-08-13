import { z } from "zod";
import type { NodeStyle, Op, Presentation } from "./types.js";

export const pathSchema = z.string().endsWith(".mmd").describe("Path to the Mermaid source file");

export const styleSchema = z.object({
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().positive().optional(),
  radius: z.number().nonnegative().optional(),
  textColor: z.string().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().positive().optional(),
  role: z.enum(["default", "primary", "secondary", "critical", "muted"]).optional(),
});

export const presentationSchema = z.object({
  preset: z.enum(["slides-16:9", "slides-4:3", "a4-portrait", "readme-wide"]).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  padding: z.number().nonnegative().optional(),
  minFontSize: z.number().positive().optional(),
  background: z.string().optional(),
  transparent: z.boolean().optional(),
  rasterScale: z.number().positive().optional(),
});

export const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("move_node"), node: z.string(), dx: z.number(), dy: z.number() }),
  z.object({ op: z.literal("resize_node"), node: z.string(), width: z.number().positive().optional(), height: z.number().positive().optional() }),
  z.object({ op: z.literal("align_nodes"), nodes: z.array(z.string()).min(2), edge: z.enum(["left", "right", "top", "bottom", "centerX", "centerY"]) }),
  z.object({ op: z.literal("distribute_nodes"), nodes: z.array(z.string()).min(2), axis: z.enum(["horizontal", "vertical"]), gap: z.number().optional(), order: z.enum(["given", "current"]).optional() }),
  z.object({ op: z.literal("row_nodes"), nodes: z.array(z.string()).min(1), gap: z.number().nonnegative(), align: z.enum(["top", "center", "bottom"]).optional() }),
  z.object({ op: z.literal("stack_nodes"), nodes: z.array(z.string()).min(1), gap: z.number().nonnegative(), align: z.enum(["left", "center", "right"]).optional() }),
  z.object({ op: z.literal("equalize_size"), nodes: z.array(z.string()).min(1), dimension: z.enum(["width", "height", "both"]), value: z.number().positive().optional() }),
  z.object({ op: z.literal("place_relative"), node: z.string(), reference: z.string(), side: z.enum(["above", "below", "left", "right"]), gap: z.number().nonnegative(), crossAxis: z.enum(["center", "keep"]).optional() }),
  z.object({ op: z.literal("set_node_style"), node: z.string(), style: styleSchema }),
  z.object({ op: z.literal("style_nodes"), nodes: z.array(z.string()).min(1), style: styleSchema }),
  z.object({ op: z.literal("set_presentation"), presentation: presentationSchema }),
  z.object({ op: z.literal("apply_theme"), theme: z.enum(["executive-light", "technical", "monochrome"]) }),
  z.object({ op: z.literal("reroute_edges"), edges: z.array(z.string()).min(1).optional() }),
]);

export const opsSchema = z.array(opSchema).min(1);

export function parseOps(value: unknown): Op[] {
  return opsSchema.parse(value) as Op[];
}

export function cleanStyle(style: z.infer<typeof styleSchema>): NodeStyle {
  return Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined)) as NodeStyle;
}

export function cleanPresentation(value: z.infer<typeof presentationSchema>): Presentation {
  return Object.fromEntries(Object.entries(value).filter(([, candidate]) => candidate !== undefined)) as Presentation;
}
