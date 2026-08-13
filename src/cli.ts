#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { Command, Option } from "commander";
import { doctorBrowser } from "./paint.js";
import { startEditor } from "./editor.js";
import { explain, history } from "./explain.js";
import { render, resolve, type RenderResult } from "./render.js";
import { structuredResult } from "./result.js";
import { parseOps } from "./schemas.js";
import { startServer } from "./mcp.js";
import { makeLog, readLog, readLogSnapshot, writeOpLog } from "./store.js";
import { applyTransaction, repair, resetLayout, restoreLayout, undoTransaction } from "./transaction.js";
import type { AlignEdge, DiagnosticProfile, NodeStyle, Op, Presentation, PresentationPreset, ThemeName } from "./types.js";

const program = new Command()
  .name("straightedge")
  .description("Conversational layout control and publishability checks for Mermaid flowcharts")
  .version("0.2.0-alpha.1");

program
  .command("render <source>")
  .option("-o, --output <path>", "defaults beside the source")
  .option("--svg", "write SVG instead of PNG")
  .option("--json", "print the structured result")
  .action(async (source: string, options: { output?: string; svg?: boolean; json?: boolean }) => {
    const result = await render(source);
    const output = options.output ?? source.replace(/\.mmd$/, options.svg ? ".svg" : ".png");
    writeFileSync(output, options.svg ? result.svg : result.png);
    if (options.json) console.log(JSON.stringify({ output, ...structuredResult(result) }, null, 2));
    else {
      console.log(output);
      report(result);
    }
    setExit(result);
  });

program.command("inspect <source>").option("--geometry-only", "skip final browser paint checks").action(async (source: string, options: { geometryOnly?: boolean }) => {
  const result = options.geometryOnly ? await resolve(source) : await render(source);
  console.log(JSON.stringify({ ...structuredResult(result), opLog: readLog(source) }, null, 2));
});

program.command("check <source>")
  .option("--json", "print the structured result")
  .addOption(new Option("--profile <profile>").choices(["geometry", "presentation"]))
  .option("--suppress <problem-id>", "suppress one advisory for this invocation", collect, [])
  .action(async (source: string, options: { json?: boolean; profile?: DiagnosticProfile; suppress: string[] }) => {
  const result = await render(source, undefined, { ...(options.profile === undefined ? {} : { profile: options.profile }), suppress: options.suppress });
  if (options.json) console.log(JSON.stringify(structuredResult(result), null, 2));
  else report(result);
  setExit(result);
});

program.command("move <source> <node>")
  .requiredOption("--dx <pixels>", "horizontal delta", number)
  .requiredOption("--dy <pixels>", "vertical delta", number)
  .option("--json")
  .action((source: string, node: string, options: { dx: number; dy: number; json?: boolean }) =>
    mutate(source, [{ op: "move_node", node, dx: options.dx, dy: options.dy }], options.json));

program.command("resize <source> <node>")
  .option("--width <pixels>", "resolved width", positive)
  .option("--height <pixels>", "resolved height", positive)
  .option("--scale <factor>", "scale current measured shape, e.g. 0.9", positive)
  .option("--json")
  .action(async (source: string, node: string, options: { width?: number; height?: number; scale?: number; json?: boolean }) => {
    if (options.width === undefined && options.height === undefined && options.scale === undefined) {
      throw new Error("resize requires --width, --height, or --scale");
    }
    const inspected = await resolve(source);
    const current = inspected.layout.nodes[node];
    if (!current) throw new Error(`no node "${node}" in this diagram`);
    const preserveAspect = current.shape === "circle" && (options.width !== undefined || options.height !== undefined);
    const width = options.width ?? (options.scale === undefined ? (preserveAspect ? options.height : undefined) : current.width * options.scale);
    const height = options.height ?? (options.scale === undefined ? (preserveAspect ? options.width : undefined) : current.height * options.scale);
    await mutate(source, [{ op: "resize_node", node, ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }) }], options.json);
  });

program.command("align <source> <nodes...>")
  .addOption(new Option("--edge <edge>").choices(["left", "right", "top", "bottom", "centerX", "centerY"]).makeOptionMandatory())
  .option("--json")
  .action((source: string, nodes: string[], options: { edge: AlignEdge; json?: boolean }) => {
    if (nodes.length < 2) throw new Error("align requires at least two nodes");
    return mutate(source, [{ op: "align_nodes", nodes, edge: options.edge }], options.json);
  });

program.command("distribute <source> <nodes...>")
  .addOption(new Option("--axis <axis>").choices(["horizontal", "vertical"]).makeOptionMandatory())
  .addOption(new Option("--order <order>").choices(["given", "current"]).default("given"))
  .option("--gap <pixels>", "explicit gap", number)
  .option("--json")
  .action((source: string, nodes: string[], options: { axis: "horizontal" | "vertical"; order: "given" | "current"; gap?: number; json?: boolean }) => {
    if (nodes.length < 2) throw new Error("distribute requires at least two nodes");
    return mutate(source, [{ op: "distribute_nodes", nodes, axis: options.axis, order: options.order, ...(options.gap === undefined ? {} : { gap: options.gap }) }], options.json);
  });

program.command("row <source> <nodes...>")
  .requiredOption("--gap <pixels>", "gap between nodes", nonnegative)
  .addOption(new Option("--align <alignment>").choices(["top", "center", "bottom"]).default("center"))
  .option("--json")
  .action((source: string, nodes: string[], options: { gap: number; align: "top" | "center" | "bottom"; json?: boolean }) => {
    if (nodes.length < 2) throw new Error("row requires at least two nodes");
    return mutate(source, [{ op: "row_nodes", nodes, gap: options.gap, align: options.align }], options.json);
  });

program.command("stack <source> <nodes...>")
  .requiredOption("--gap <pixels>", "gap between nodes", nonnegative)
  .addOption(new Option("--align <alignment>").choices(["left", "center", "right"]).default("center"))
  .option("--json")
  .action((source: string, nodes: string[], options: { gap: number; align: "left" | "center" | "right"; json?: boolean }) => {
    if (nodes.length < 2) throw new Error("stack requires at least two nodes");
    return mutate(source, [{ op: "stack_nodes", nodes, gap: options.gap, align: options.align }], options.json);
  });

program.command("equalize <source> <nodes...>")
  .addOption(new Option("--dimension <dimension>").choices(["width", "height", "both"]).makeOptionMandatory())
  .option("--value <pixels>", "explicit size", positive)
  .option("--json")
  .action((source: string, nodes: string[], options: { dimension: "width" | "height" | "both"; value?: number; json?: boolean }) =>
    mutate(source, [{ op: "equalize_size", nodes, dimension: options.dimension, ...(options.value === undefined ? {} : { value: options.value }) }], options.json));

program.command("place <source> <node> <reference>")
  .addOption(new Option("--side <side>").choices(["above", "below", "left", "right"]).makeOptionMandatory())
  .requiredOption("--gap <pixels>", "gap between shapes", nonnegative)
  .addOption(new Option("--cross-axis <mode>").choices(["center", "keep"]).default("center"))
  .option("--json")
  .action((source: string, node: string, reference: string, options: { side: "above" | "below" | "left" | "right"; gap: number; crossAxis: "center" | "keep"; json?: boolean }) =>
    mutate(source, [{ op: "place_relative", node, reference, side: options.side, gap: options.gap, crossAxis: options.crossAxis }], options.json));

program.command("style <source> <nodes...>")
  .option("--fill <color>").option("--stroke <color>").option("--stroke-width <pixels>", "", positive)
  .option("--text-color <color>").option("--font-size <pixels>", "", positive).option("--font-weight <weight>")
  .addOption(new Option("--role <role>").choices(["default", "primary", "secondary", "critical", "muted"]))
  .option("--json")
  .action((source: string, nodes: string[], options: Record<string, unknown>) => {
    const style = compact({
      fill: options.fill,
      stroke: options.stroke,
      strokeWidth: options.strokeWidth,
      textColor: options.textColor,
      fontSize: options.fontSize,
      fontWeight: options.fontWeight,
      role: options.role,
    }) as NodeStyle;
    if (Object.keys(style).length === 0) throw new Error("style requires at least one style option");
    return mutate(source, [{ op: "style_nodes", nodes, style }], options.json === true);
  });

program.command("theme <source> <theme>")
  .option("--json")
  .action((source: string, theme: string, options: { json?: boolean }) => {
    if (!new Set(["executive-light", "technical", "monochrome"]).has(theme)) throw new Error(`unknown theme "${theme}"`);
    return mutate(source, [{ op: "apply_theme", theme: theme as ThemeName }], options.json);
  });

program.command("frame <source> [preset]")
  .option("--width <pixels>", "", positive).option("--height <pixels>", "", positive)
  .option("--padding <pixels>", "", nonnegative).option("--min-font-size <pixels>", "", positive)
  .option("--background <color>").option("--transparent").option("--raster-scale <factor>", "", positive)
  .option("--json")
  .action((source: string, preset: string | undefined, options: Record<string, unknown>) => {
    if (preset && !new Set(["slides-16:9", "slides-4:3", "a4-portrait", "readme-wide"]).has(preset)) throw new Error(`unknown presentation preset "${preset}"`);
    const presentation: Presentation = compact({
      preset: preset as PresentationPreset | undefined,
      width: options.width,
      height: options.height,
      padding: options.padding,
      minFontSize: options.minFontSize,
      background: options.background,
      transparent: options.transparent,
      rasterScale: options.rasterScale,
    }) as Presentation;
    return mutate(source, [{ op: "set_presentation", presentation }], options.json === true);
  });

program.command("reroute <source> [edges...]").option("--json").action((source: string, edges: string[], options: { json?: boolean }) =>
  mutate(source, [{ op: "reroute_edges", ...(edges.length === 0 ? {} : { edges }) }], options.json));

program.command("apply <source> <json-or-file>").option("--json").action(async (source: string, payload: string, options: { json?: boolean }) => {
  const text = payload.startsWith("@") ? readFileSync(payload.slice(1), "utf8") : payload;
  await mutate(source, parseOps(JSON.parse(text)), options.json);
});

program.command("repair <source>").option("--json").action(async (source: string, options: { json?: boolean }) => {
  const repaired = await repair(source);
  if (options.json) console.log(JSON.stringify({ committed: repaired.committed, passes: repaired.passes, appliedOps: repaired.appliedOps, reason: repaired.reason, ...structuredResult(repaired.result) }, null, 2));
  else {
    console.log(repaired.committed ? `committed ${repaired.appliedOps.length} repair operation(s)` : "no repair committed");
    if (repaired.reason) console.error(repaired.reason);
    report(repaired.result);
  }
  setExit(repaired.result);
});

program.command("history <source>").option("--json").action(async (source: string, options: { json?: boolean }) => {
  const trace = await history(source);
  if (options.json) console.log(JSON.stringify(trace, null, 2));
  else for (const item of trace) console.log(`${item.index}: ${item.op.op} — ${item.state}${item.notes.length ? ` (${item.notes.join("; ")})` : ""}`);
});

program.command("explain <source>").option("--json").action(async (source: string, options: { json?: boolean }) => {
  const result = await explain(source);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Mermaid direction: ${result.sourceDirection}`);
    console.log(`Horizontal order: ${result.horizontalOrder.join(" → ")}`);
    console.log(`Vertical order: ${result.verticalOrder.join(" → ")}`);
    console.log(`Checks: ${result.diagnosticProfile} — ${result.claim}`);
    for (const finding of result.findings) console.log(`${finding.kind}: ${finding.message}`);
  }
});

program.command("undo <source>").option("--json").action(async (source: string, options: { json?: boolean }) => {
  const undone = await undoTransaction(source);
  if (options.json) console.log(JSON.stringify({ committed: undone.committed, removed: undone.removed, path: undone.path, ...structuredResult(undone.result) }, null, 2));
  else {
    console.log(undone.committed ? `updated ${undone.path}\nremoved ${JSON.stringify(undone.removed)}` : `no operation to undo in ${undone.path}`);
    report(undone.result);
  }
  setExit(undone.result);
});

program.command("reset <source>")
  .option("--yes", "perform the reset after previewing the baseline")
  .option("--no-backup", "do not create a recoverable backup; requires --yes")
  .option("--json")
  .action(async (source: string, options: { yes?: boolean; backup: boolean; json?: boolean }) => {
    if (options.backup === false && !options.yes) throw new Error("--no-backup requires --yes");
    const reset = await resetLayout(source, { ...(options.yes === undefined ? {} : { confirm: options.yes }), backup: options.backup });
    const summary = { committed: reset.committed, path: reset.path, operationCount: reset.operationCount, version: reset.version, backupPath: reset.backupPath, ...structuredResult(reset.result) };
    if (options.json) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(`${reset.committed ? "reset" : "would reset"} ${reset.path} (${reset.operationCount} operations, v${reset.version})`);
      if (reset.backupPath) console.log(`${reset.committed ? "backup" : "planned backup"}: ${reset.backupPath}`);
      if (!options.yes && reset.operationCount > 0) console.log("Run again with --yes to commit this reset.");
      report(reset.result);
    }
    setExit(reset.result);
  });

program.command("restore <source> <backup>")
  .option("--dry-run", "preview restoration (the default)")
  .option("--yes", "perform the restore after previewing it")
  .option("--json")
  .action(async (source: string, backup: string, options: { yes?: boolean; json?: boolean }) => {
    const restored = await restoreLayout(source, backup, options.yes === undefined ? {} : { confirm: options.yes });
    if (options.json) console.log(JSON.stringify({ committed: restored.committed, path: restored.path, backupPath: backup, ...structuredResult(restored.result) }, null, 2));
    else {
      console.log(`${restored.committed ? "restored" : "would restore"} ${backup} → ${restored.path}`);
      if (!options.yes) console.log("Run again with --yes to commit this restore.");
      report(restored.result);
    }
    setExit(restored.result);
  });

program.command("migrate <source>")
  .option("--dry-run", "preview migration (the default)")
  .option("--yes", "write the v3 log; otherwise dry-run")
  .option("--json")
  .action((source: string, options: { yes?: boolean; json?: boolean }) => {
    const snapshot = readLogSnapshot(source);
    const ops = snapshot.log.ops.map((op) => op.op === "distribute_nodes" && op.order === undefined ? { ...op, order: "current" as const } : op);
    const migrated = makeLog(ops, 3);
    if (options.yes) writeOpLog(source, migrated, snapshot.raw);
    const summary = { committed: options.yes ?? false, fromVersion: snapshot.log.version, toVersion: 3, path: source.replace(/\.mmd$/, ".layout.json"), log: migrated };
    if (options.json) console.log(JSON.stringify(summary, null, 2));
    else console.log(`${options.yes ? "migrated" : "would migrate"} ${summary.path} from v${summary.fromVersion} to v3`);
});

program.command("doctor").option("--json").action(async (options: { json?: boolean }) => {
  const browser = await doctorBrowser();
  const result = { ok: browser.ok, node: process.version, platform: `${process.platform}-${process.arch}`, browser };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${browser.ok ? "ok" : "failed"}: ${browser.message}\n${browser.executable}${browser.version ? `\n${browser.version}` : ""}`);
  if (!browser.ok) process.exitCode = 2;
});

program.command("edit <source>").option("--port <number>", "loopback port; defaults to an available port", nonnegative).action(async (source: string, options: { port?: number }) => {
  const editor = await startEditor(source, options.port ?? 0);
  console.log(editor.url);
  await new Promise<void>((resolve) => {
    const stop = () => void editor.close().then(resolve);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
});

program.command("mcp").action(startServer);

program.parseAsync().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 2;
});

async function mutate(source: string, ops: Op[], json = false): Promise<void> {
  const transaction = await applyTransaction(source, ops);
  if (transaction.committed) {
    const output = source.replace(/\.mmd$/, ".png");
    writeFileSync(output, transaction.result.png);
    if (!json) console.log(`${output}\ncommitted ${ops.length} operation(s)`);
  } else if (!json) {
    console.error(transaction.reason);
  }
  if (json) console.log(JSON.stringify({ committed: transaction.committed, appliedOps: transaction.appliedOps, reason: transaction.reason, ...structuredResult(transaction.result) }, null, 2));
  else report(transaction.result);
  if (!transaction.committed) process.exitCode = 2;
  else setExit(transaction.result);
}

function report(result: RenderResult): void {
  for (const warning of result.warnings) console.error(`warning: ${warning}`);
  for (const item of result.problems) console.error(`${item.severity}: ${item.message}`);
  console.error(result.check.claim);
  if (result.status !== "clean") console.error(`layout status: ${result.status}`);
}

function setExit(result: RenderResult): void {
  process.exitCode = result.status === "clean" ? 0 : result.status === "review" ? 1 : 2;
}

function number(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`expected a number, received "${value}"`);
  return parsed;
}

function positive(value: string): number {
  const parsed = number(value);
  if (parsed <= 0) throw new Error("value must be positive");
  return parsed;
}

function nonnegative(value: string): number {
  const parsed = number(value);
  if (parsed < 0) throw new Error("value must be non-negative");
  return parsed;
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, candidate]) => candidate !== undefined && candidate !== false)) as T;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
