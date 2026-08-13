/** Agent-facing MCP server. Every visual mutation returns the new image. */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Browser } from "puppeteer";
import { openBrowser } from "./paint.js";
import { explain, history } from "./explain.js";
import { render, resolve, type RenderResult } from "./render.js";
import { structuredResult } from "./result.js";
import { cleanPresentation, cleanStyle, opSchema, presentationSchema, styleSchema } from "./schemas.js";
import { readLog } from "./store.js";
import { applyTransaction, repair, resetLayout, restoreLayout, undoTransaction } from "./transaction.js";
import type { Op } from "./types.js";

export const INSTRUCTIONS = `
Straightedge gives you structured control over the layout of Mermaid flowcharts.

Always call inspect first. Guessing at node ids is the most common way this fails.
After every edit, examine both the returned image and layout warnings. Correct any
overlap or edge crossing before telling the user the diagram is finished.

When editing an existing diagram, preserve existing Mermaid node IDs unless the
thing they represent has genuinely changed. IDs are layout identity; labels are
free to change. Prefer semantic snake_case ids with bracketed labels —
primary_db["Postgres"], not db1.

Apply operations coarse to fine: sizing, then distribution and alignment, then
relative placement, then nudges. Later operations can undo earlier intent.
`.trim();

const pathSchema = z.string().endsWith(".mmd").describe("Path to the Mermaid source file");
let mcpBrowser: Browser | undefined;

async function browserForMcp(): Promise<Browser> {
  if (!mcpBrowser?.connected) mcpBrowser = await openBrowser();
  return mcpBrowser;
}

async function mutate(path: string, op: Op) {
  const transaction = await applyTransaction(path, [op], { browser: await browserForMcp() });
  return imageResult(transaction.result, "png", {
    committed: transaction.committed,
    appliedOps: transaction.appliedOps,
    ...(transaction.reason === undefined ? {} : { reason: transaction.reason }),
  });
}

function imageResult(result: RenderResult, format: "png" | "svg" = "png", extra: Record<string, unknown> = {}) {
  const notes = [
    ...result.warnings.map((warning) => `Warning: ${warning}`),
    ...result.problems.map((problem) => `Layout problem: ${problem.message}`),
  ];
  return {
    content: [
      { type: "text" as const, text: notes.join("\n") || result.check.claim },
      {
        type: "image" as const,
        data: format === "png" ? result.png.toString("base64") : Buffer.from(result.svg).toString("base64"),
        mimeType: format === "png" ? "image/png" : "image/svg+xml",
      },
    ],
    structuredContent: { ...extra, ...structuredResult(result) },
  };
}

export const TOOLS = [
  "create_diagram",
  "render",
  "inspect",
  "check_layout",
  "move_node",
  "resize_node",
  "align_nodes",
  "distribute_nodes",
  "row_nodes",
  "stack_nodes",
  "equalize_size",
  "place_relative",
  "set_node_style",
  "style_nodes",
  "set_presentation",
  "apply_theme",
  "reroute_edges",
  "apply_transaction",
  "repair",
  "history",
  "explain",
  "undo",
  "reset_layout",
  "restore_layout",
] as const;

export async function startServer(): Promise<void> {
  const server = new McpServer(
    { name: "straightedge", version: "0.2.0-alpha.1" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "create_diagram",
    {
      description: "Create a new Mermaid flowchart, render it, and return its image and node IDs.",
      inputSchema: { path: pathSchema, mermaid: z.string().min(1) },
    },
    async ({ path, mermaid }) => {
      if (existsSync(path)) throw new Error(`${path} already exists`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, mermaid.endsWith("\n") ? mermaid : `${mermaid}\n`);
      const result = await render(path, await browserForMcp());
      const ids = Object.keys(result.layout.nodes).join(", ");
      const response = imageResult(result);
      response.content[0]!.text = `Node IDs: ${ids}\n${response.content[0]!.text}`;
      return response;
    },
  );

  server.registerTool(
    "render",
    {
      description: "Render a Mermaid diagram using its saved Straightedge layout operations.",
      inputSchema: { path: pathSchema, format: z.enum(["png", "svg"]).optional() },
    },
    async ({ path, format }) => imageResult(await render(path, await browserForMcp()), format ?? "png"),
  );

  server.registerTool(
    "inspect",
    {
      description: "Inspect exact node IDs and geometry before editing. Always call this first.",
      inputSchema: { path: pathSchema },
    },
    async ({ path }) => {
      const result = await render(path, await browserForMcp());
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                canvas: result.canvas,
                nodes: Object.values(result.layout.nodes),
                edges: result.layout.edges,
                opLog: readLog(path),
                warnings: result.warnings,
                problems: result.problems,
                frame: result.frame,
                status: result.status,
              },
              null,
              2,
            ),
          },
        ],
        structuredContent: structuredResult(result),
      };
    },
  );

  server.registerTool(
    "check_layout",
    {
      description: "Check for overlaps, tight gaps, edge crossings, and stale layout operations.",
      inputSchema: {
        path: pathSchema,
        profile: z.enum(["geometry", "presentation"]).optional(),
        suppress: z.array(z.string()).optional(),
      },
    },
    async ({ path, profile, suppress }) => {
      const result = await render(path, await browserForMcp(), {
        ...(profile === undefined ? {} : { profile }),
        ...(suppress === undefined ? {} : { suppress }),
      });
      const messages = [...result.warnings, ...result.problems.map((problem) => problem.message)];
      return {
        content: [{ type: "text" as const, text: messages.join("\n") || result.check.claim }],
        structuredContent: structuredResult(result),
      };
    },
  );

  server.registerTool(
    "move_node",
    {
      description: "Nudge one node by a relative pixel delta. Inspect first; use after structural edits.",
      inputSchema: { path: pathSchema, node: z.string(), dx: z.number(), dy: z.number() },
    },
    ({ path, node, dx, dy }) => mutate(path, { op: "move_node", node, dx, dy }),
  );

  server.registerTool(
    "resize_node",
    {
      description: "Resize around the center. Use scale: 0.9 for about 10% smaller; circles preserve a 1:1 aspect ratio.",
      inputSchema: {
        path: pathSchema,
        node: z.string(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        scale: z.number().positive().optional(),
      },
    },
    async ({ path, node, width, height, scale }) => {
      const inspected = await resolve(path, await browserForMcp());
      const current = inspected.layout.nodes[node];
      if (!current) throw new Error(`no node "${node}" in this diagram`);
      const preserveAspect = current.shape === "circle" && (width !== undefined || height !== undefined);
      const resolvedWidth = width ?? (scale === undefined ? (preserveAspect ? height : undefined) : current.width * scale);
      const resolvedHeight = height ?? (scale === undefined ? (preserveAspect ? width : undefined) : current.height * scale);
      if (resolvedWidth === undefined && resolvedHeight === undefined) throw new Error("resize_node requires width, height, or scale");
      return mutate(path, {
        op: "resize_node",
        node,
        ...(resolvedWidth === undefined ? {} : { width: resolvedWidth }),
        ...(resolvedHeight === undefined ? {} : { height: resolvedHeight }),
      });
    },
  );

  server.registerTool(
    "align_nodes",
    {
      description: "Align nodes to the first listed node, which stays fixed.",
      inputSchema: {
        path: pathSchema,
        nodes: z.array(z.string()).min(2),
        edge: z.enum(["left", "right", "top", "bottom", "centerX", "centerY"]),
      },
    },
    ({ path, nodes, edge }) => mutate(path, { op: "align_nodes", nodes, edge }),
  );

  server.registerTool(
    "distribute_nodes",
    {
      description: "Space nodes deterministically in argument order by default, or preserve current spatial order explicitly.",
      inputSchema: {
        path: pathSchema,
        nodes: z.array(z.string()).min(2),
        axis: z.enum(["horizontal", "vertical"]),
        gap: z.number().optional(),
        order: z.enum(["given", "current"]).optional(),
      },
    },
    ({ path, nodes, axis, gap, order }) =>
      mutate(path, {
        op: "distribute_nodes",
        nodes,
        axis,
        order: order ?? "given",
        ...(gap === undefined ? {} : { gap }),
      }),
  );

  server.registerTool(
    "row_nodes",
    {
      description: "Place nodes left-to-right in the exact given order with a shared cross-axis alignment.",
      inputSchema: {
        path: pathSchema,
        nodes: z.array(z.string()).min(1),
        gap: z.number().nonnegative(),
        align: z.enum(["top", "center", "bottom"]).optional(),
      },
    },
    ({ path, nodes, gap, align }) => mutate(path, { op: "row_nodes", nodes, gap, ...(align === undefined ? {} : { align }) }),
  );

  server.registerTool(
    "stack_nodes",
    {
      description: "Place nodes top-to-bottom in the exact given order with a shared cross-axis alignment.",
      inputSchema: {
        path: pathSchema,
        nodes: z.array(z.string()).min(1),
        gap: z.number().nonnegative(),
        align: z.enum(["left", "center", "right"]).optional(),
      },
    },
    ({ path, nodes, gap, align }) => mutate(path, { op: "stack_nodes", nodes, gap, ...(align === undefined ? {} : { align }) }),
  );

  server.registerTool(
    "equalize_size",
    {
      description: "Give nodes equal width, height, or both. Defaults to the largest existing size.",
      inputSchema: {
        path: pathSchema,
        nodes: z.array(z.string()).min(1),
        dimension: z.enum(["width", "height", "both"]),
        value: z.number().positive().optional(),
      },
    },
    ({ path, nodes, dimension, value }) =>
      mutate(path, {
        op: "equalize_size",
        nodes,
        dimension,
        ...(value === undefined ? {} : { value }),
      }),
  );

  server.registerTool(
    "place_relative",
    {
      description: "Place a node beside a fixed reference, centered on the other axis by default.",
      inputSchema: {
        path: pathSchema,
        node: z.string(),
        reference: z.string(),
        side: z.enum(["above", "below", "left", "right"]),
        gap: z.number().nonnegative(),
        crossAxis: z.enum(["center", "keep"]).optional(),
      },
    },
    ({ path, node, reference, side, gap, crossAxis }) =>
      mutate(path, {
        op: "place_relative",
        node,
        reference,
        side,
        gap,
        ...(crossAxis === undefined ? {} : { crossAxis }),
      }),
  );

  server.registerTool(
    "set_node_style",
    {
      description: "Change a node's fill, border, radius, or text styling without changing geometry.",
      inputSchema: { path: pathSchema, node: z.string(), style: styleSchema },
    },
    ({ path, node, style }) => mutate(path, { op: "set_node_style", node, style: cleanStyle(style) }),
  );

  server.registerTool(
    "style_nodes",
    {
      description: "Apply one style or semantic theme role to several nodes in one transaction.",
      inputSchema: { path: pathSchema, nodes: z.array(z.string()).min(1), style: styleSchema },
    },
    ({ path, nodes, style }) => mutate(path, { op: "style_nodes", nodes, style: cleanStyle(style) }),
  );

  server.registerTool(
    "set_presentation",
    {
      description: "Set a persistent target frame, padding, readability floor, background, and raster scale.",
      inputSchema: { path: pathSchema, presentation: presentationSchema },
    },
    ({ path, presentation }) => mutate(path, { op: "set_presentation", presentation: cleanPresentation(presentation) }),
  );

  server.registerTool(
    "apply_theme",
    {
      description: "Apply a curated presentation theme while preserving explicit node overrides.",
      inputSchema: { path: pathSchema, theme: z.enum(["executive-light", "technical", "monochrome"]) },
    },
    ({ path, theme }) => mutate(path, { op: "apply_theme", theme }),
  );

  server.registerTool(
    "reroute_edges",
    {
      description: "Obstacle-route selected edges, or every edge when ids are omitted.",
      inputSchema: { path: pathSchema, edges: z.array(z.string()).min(1).optional() },
    },
    ({ path, edges }) => mutate(path, { op: "reroute_edges", ...(edges === undefined ? {} : { edges }) }),
  );

  server.registerTool(
    "apply_transaction",
    {
      description: "Apply a coherent batch atomically. A candidate with errors is returned but never persisted.",
      inputSchema: { path: pathSchema, ops: z.array(opSchema).min(1) },
    },
    async ({ path, ops }) => {
      const transaction = await applyTransaction(path, ops as Op[], { browser: await browserForMcp() });
      return imageResult(transaction.result, "png", {
        committed: transaction.committed,
        appliedOps: transaction.appliedOps,
        ...(transaction.reason === undefined ? {} : { reason: transaction.reason }),
      });
    },
  );

  server.registerTool(
    "repair",
    {
      description: "Apply bounded safe repairs only when they reduce diagnostic severity.",
      inputSchema: { path: pathSchema, maximumPasses: z.number().int().min(1).max(3).optional() },
    },
    async ({ path, maximumPasses }) => {
      const repaired = await repair(path, maximumPasses ?? 3, await browserForMcp());
      return imageResult(repaired.result, "png", {
        committed: repaired.committed,
        passes: repaired.passes,
        appliedOps: repaired.appliedOps,
        ...(repaired.reason === undefined ? {} : { reason: repaired.reason }),
      });
    },
  );

  server.registerTool(
    "history",
    {
      description: "Explain each operation's effective, overridden, or skipped replay state.",
      inputSchema: { path: pathSchema },
    },
    async ({ path }) => {
      const trace = await history(path, await browserForMcp());
      return { content: [{ type: "text" as const, text: JSON.stringify(trace, null, 2) }], structuredContent: { trace } };
    },
  );

  server.registerTool(
    "explain",
    {
      description: "Summarize Mermaid direction, effective ordering, active policy, and overridden intent.",
      inputSchema: { path: pathSchema },
    },
    async ({ path }) => {
      const result = await explain(path, await browserForMcp());
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], structuredContent: { ...result } };
    },
  );

  server.registerTool(
    "undo",
    { description: "Atomically remove the most recent operation after a successful candidate render.", inputSchema: { path: pathSchema } },
    async ({ path }) => {
      const undone = await undoTransaction(path, await browserForMcp());
      return imageResult(undone.result, "png", { committed: undone.committed, removed: undone.removed, path: undone.path });
    },
  );

  server.registerTool(
    "reset_layout",
    {
      description: "Preview a reset, or reset with an automatic recoverable backup when confirm is true.",
      inputSchema: { path: pathSchema, confirm: z.boolean().optional() },
    },
    async ({ path, confirm }) => {
      const reset = await resetLayout(path, { confirm: confirm ?? false, browser: await browserForMcp() });
      return imageResult(reset.result, "png", {
        committed: reset.committed,
        path: reset.path,
        operationCount: reset.operationCount,
        ...(reset.backupPath === undefined ? {} : { backupPath: reset.backupPath }),
      });
    },
  );

  server.registerTool(
    "restore_layout",
    {
      description: "Preview or atomically restore a reset backup.",
      inputSchema: { path: pathSchema, backupPath: z.string(), confirm: z.boolean().optional() },
    },
    async ({ path, backupPath, confirm }) => {
      const restored = await restoreLayout(path, backupPath, { confirm: confirm ?? false, browser: await browserForMcp() });
      return imageResult(restored.result, "png", { committed: restored.committed, path: restored.path, backupPath });
    },
  );

  const shutdown = () => {
    const closed = mcpBrowser?.connected ? mcpBrowser.close() : Promise.resolve();
    void closed.finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("exit", () => {
    if (mcpBrowser?.connected) void mcpBrowser.close();
  });
  await server.connect(new StdioServerTransport());
}
