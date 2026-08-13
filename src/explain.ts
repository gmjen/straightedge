import type { Browser } from "puppeteer";
import { render, resolve } from "./render.js";
import { readLog } from "./store.js";
import type { ReplayTrace } from "./types.js";

export interface ExplainFinding {
  kind: "direction_conflict" | "overridden_intent" | "stale_intent" | "redundant_intent";
  message: string;
  operations: number[];
}

export interface ExplainResult {
  sourceDirection: string;
  horizontalOrder: string[];
  verticalOrder: string[];
  theme?: string;
  presentation: object;
  diagnosticProfile: string;
  claim: string;
  findings: ExplainFinding[];
}

export async function history(sourcePath: string, browser?: Browser): Promise<ReplayTrace[]> {
  return (await resolve(sourcePath, browser)).trace;
}

export async function explain(sourcePath: string, browser?: Browser): Promise<ExplainResult> {
  const result = await render(sourcePath, browser, { profile: "presentation" });
  const nodes = Object.values(result.layout.nodes);
  const findings: ExplainFinding[] = [];
  for (const trace of result.trace) {
    if (trace.state === "overridden" || trace.state === "partially_overridden") {
      findings.push({
        kind: "overridden_intent",
        message: `operation ${trace.index} (${trace.op.op}) is ${trace.state.replace("_", " ")}`,
        operations: [trace.index],
      });
    } else if (trace.state === "skipped") {
      findings.push({
        kind: "stale_intent",
        message: `operation ${trace.index} (${trace.op.op}) was skipped: ${trace.notes.join("; ")}`,
        operations: [trace.index],
      });
    }
  }
  findings.push(...brokenIntent(result.trace));
  for (const issue of result.problems.filter((candidate) => candidate.kind === "direction_contradiction")) {
    findings.push({ kind: "direction_conflict", message: issue.message, operations: directionChangingOps(result.trace) });
  }
  const duplicates = adjacentDuplicates(readLog(sourcePath).ops);
  for (const index of duplicates) {
    findings.push({
      kind: "redundant_intent",
      message: `operation ${index} exactly duplicates the preceding operation`,
      operations: [index - 1, index],
    });
  }
  return {
    sourceDirection: result.sourceDirection,
    horizontalOrder: [...nodes].sort((a, b) => a.x - b.x).map((node) => node.id),
    verticalOrder: [...nodes].sort((a, b) => a.y - b.y).map((node) => node.id),
    ...(result.theme === undefined ? {} : { theme: result.theme }),
    presentation: result.presentation,
    diagnosticProfile: result.check.profile,
    claim: result.check.claim,
    findings,
  };
}

function brokenIntent(trace: ReplayTrace[]): ExplainFinding[] {
  const findings: ExplainFinding[] = [];
  for (const item of trace) {
    if (!new Set(["align_nodes", "distribute_nodes", "row_nodes", "stack_nodes"]).has(item.op.op)) continue;
    const subjects = new Set("nodes" in item.op ? item.op.nodes : []);
    const later = trace.find((candidate) =>
      candidate.index > item.index
      && candidate.state !== "skipped"
      && candidate.op.op === "move_node"
      && subjects.has(candidate.op.node));
    if (later) {
      findings.push({
        kind: "overridden_intent",
        message: `operation ${item.index} (${item.op.op}) was later adjusted by move operation ${later.index}`,
        operations: [item.index, later.index],
      });
    }
  }
  return findings;
}

function directionChangingOps(trace: ReplayTrace[]): number[] {
  return trace
    .filter((item) => new Set(["move_node", "align_nodes", "distribute_nodes", "row_nodes", "stack_nodes", "place_relative"]).has(item.op.op))
    .map((item) => item.index);
}

function adjacentDuplicates(ops: unknown[]): number[] {
  const result: number[] = [];
  for (let index = 1; index < ops.length; index++) {
    if (JSON.stringify(ops[index - 1]) === JSON.stringify(ops[index])) result.push(index);
  }
  return result;
}
