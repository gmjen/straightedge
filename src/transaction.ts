import { renderWithOps, type RenderResult } from "./render.js";
import { withBrowserSession } from "./paint.js";
import type { Browser } from "puppeteer";
import { makeLog, readLogSnapshot, writeOpLog } from "./store.js";
import type { Op, Problem } from "./types.js";

export interface TransactionOptions {
  /** Warnings are reviewable and commit by default; errors never commit. */
  commitOnReview?: boolean;
  browser?: Browser;
}

export interface TransactionResult {
  committed: boolean;
  appliedOps: Op[];
  result: RenderResult;
  reason?: string;
}

export async function applyTransaction(
  sourcePath: string,
  requested: Op[],
  options: TransactionOptions = {},
): Promise<TransactionResult> {
  if (requested.length === 0) throw new Error("a transaction requires at least one operation");
  const snapshot = readLogSnapshot(sourcePath);
  const ops: Op[] = [...snapshot.log.ops, ...requested];
  const result = await renderWithOps(sourcePath, ops, options.browser);
  const acceptable = result.status === "clean" || (result.status === "review" && (options.commitOnReview ?? true));
  if (!acceptable) {
    return {
      committed: false,
      appliedOps: [],
      result,
      reason: "candidate has publication-blocking diagnostics; operation log was not changed",
    };
  }
  writeOpLog(sourcePath, makeLog(ops, snapshot.log.version), snapshot.raw);
  return { committed: true, appliedOps: requested, result };
}

export interface RepairResult {
  committed: boolean;
  passes: number;
  appliedOps: Op[];
  result: RenderResult;
  reason?: string;
}

export async function repair(sourcePath: string, maximumPasses = 3, browser?: Browser): Promise<RepairResult> {
  if (!browser) return withBrowserSession((active) => repair(sourcePath, maximumPasses, active));
  return repairWithBrowser(sourcePath, maximumPasses, browser);
}

async function repairWithBrowser(sourcePath: string, maximumPasses: number, browser: Browser): Promise<RepairResult> {
  const initial = readLogSnapshot(sourcePath);
  let current = await renderWithOps(sourcePath, [...initial.log.ops], browser);
  const appliedOps: Op[] = [];

  for (let pass = 1; pass <= maximumPasses; pass++) {
    const suggestions = uniqueSafeSuggestions(current.problems);
    if (suggestions.length === 0) {
      return {
        committed: appliedOps.length > 0,
        passes: pass - 1,
        appliedOps,
        result: current,
        ...(current.status === "clean" ? {} : { reason: "no further safe automatic repairs are available" }),
      };
    }

    const snapshot = readLogSnapshot(sourcePath);
    const candidateOps: Op[] = [...snapshot.log.ops, ...suggestions];
    const candidate = await renderWithOps(sourcePath, candidateOps, browser);
    if (score(candidate.problems) >= score(current.problems)) {
      return {
        committed: appliedOps.length > 0,
        passes: pass - 1,
        appliedOps,
        result: current,
        reason: "the proposed repair did not improve diagnostic severity and was rolled back",
      };
    }

    writeOpLog(sourcePath, makeLog(candidateOps, snapshot.log.version), snapshot.raw);
    appliedOps.push(...suggestions);
    current = candidate;
    if (current.status === "clean") {
      return { committed: true, passes: pass, appliedOps, result: current };
    }
  }

  return {
    committed: appliedOps.length > 0,
    passes: maximumPasses,
    appliedOps,
    result: current,
    ...(current.status === "clean" ? {} : { reason: `repair stopped after ${maximumPasses} passes` }),
  };
}

function uniqueSafeSuggestions(problems: Problem[]): Op[] {
  const seen = new Set<string>();
  const result: Op[] = [];
  for (const problem of problems) {
    if (!problem.safeToAutoApply) continue;
    for (const op of problem.suggestedOps) {
      const key = JSON.stringify(op);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(op);
      }
    }
  }
  return result;
}

function score(problems: Problem[]): number {
  return problems.reduce((total, problem) => total + (problem.severity === "error" ? 100 : 1), 0);
}
