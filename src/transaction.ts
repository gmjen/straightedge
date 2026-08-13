import { renderWithOps, type RenderResult } from "./render.js";
import { withBrowserSession } from "./paint.js";
import type { Browser } from "puppeteer";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { logPathFor, makeLog, readLogSnapshot, writeOpLog } from "./store.js";
import type { Op, OpLog, Problem } from "./types.js";

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
  const requestedTrace = result.trace.slice(snapshot.log.ops.length);
  const invalidRequest = requestedTrace.find((entry) => entry.state === "skipped");
  const acceptableStatus = result.status === "clean" || (result.status === "review" && (options.commitOnReview ?? true));
  const acceptable = acceptableStatus && invalidRequest === undefined;
  if (!acceptable) {
    return {
      committed: false,
      appliedOps: [],
      result,
      reason: invalidRequest
        ? `candidate operation ${invalidRequest.index} was skipped (${invalidRequest.notes.join("; ")}); operation log was not changed`
        : "candidate has publication-blocking diagnostics; operation log was not changed",
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

export interface UndoResult {
  committed: boolean;
  removed?: Op;
  path: string;
  result: RenderResult;
}

export async function undoTransaction(sourcePath: string, browser?: Browser): Promise<UndoResult> {
  const snapshot = readLogSnapshot(sourcePath);
  const removed = snapshot.log.ops.at(-1);
  const result = await renderWithOps(sourcePath, snapshot.log.ops.slice(0, -1), browser);
  if (!removed) return { committed: false, path: logPathFor(sourcePath), result };
  writeOpLog(sourcePath, makeLog(snapshot.log.ops.slice(0, -1), snapshot.log.version), snapshot.raw);
  return { committed: true, removed, path: logPathFor(sourcePath), result };
}

export interface ResetResult {
  committed: boolean;
  path: string;
  operationCount: number;
  version: number;
  backupPath?: string;
  result: RenderResult;
}

export async function resetLayout(
  sourcePath: string,
  options: { confirm?: boolean; backup?: boolean; browser?: Browser } = {},
): Promise<ResetResult> {
  const snapshot = readLogSnapshot(sourcePath);
  const result = await renderWithOps(sourcePath, [], options.browser);
  const path = logPathFor(sourcePath);
  const backupPath = snapshot.raw === null || options.backup === false ? undefined : nextBackupPath(sourcePath);
  if (!options.confirm || snapshot.raw === null) {
    return {
      committed: false,
      path,
      operationCount: snapshot.log.ops.length,
      version: snapshot.log.version,
      ...(backupPath === undefined ? {} : { backupPath }),
      result,
    };
  }
  if (options.backup ?? true) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== snapshot.raw) {
      throw new Error(`layout operation log changed during reset: ${path}`);
    }
    mkdirSync(dirname(backupPath!), { recursive: true });
    renameSync(path, backupPath!);
  } else {
    // Atomic replacement with an empty log is safer than unlinking the active file.
    writeOpLog(sourcePath, makeLog([], snapshot.log.version), snapshot.raw);
  }
  return {
    committed: true,
    path,
    operationCount: snapshot.log.ops.length,
    version: snapshot.log.version,
    ...((options.backup ?? true) && backupPath !== undefined ? { backupPath } : {}),
    result,
  };
}

export async function restoreLayout(
  sourcePath: string,
  backupPath: string,
  options: { confirm?: boolean; browser?: Browser } = {},
): Promise<ResetResult> {
  const backup = parseBackup(backupPath);
  const result = await renderWithOps(sourcePath, [...backup.ops], options.browser);
  const active = readLogSnapshot(sourcePath);
  if (options.confirm) writeOpLog(sourcePath, backup, active.raw);
  return {
    committed: options.confirm ?? false,
    path: logPathFor(sourcePath),
    operationCount: backup.ops.length,
    version: backup.version,
    backupPath,
    result,
  };
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

function nextBackupPath(sourcePath: string): string {
  const diagram = basename(sourcePath, ".mmd");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(dirname(sourcePath), ".straightedge", "backups", diagram, `${stamp}-${randomUUID().slice(0, 8)}.layout.json`);
}

function parseBackup(path: string): OpLog {
  if (!existsSync(path)) throw new Error(`backup does not exist: ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown; ops?: unknown };
  if ((parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) || !Array.isArray(parsed.ops)) {
    throw new Error(`${path} is not a valid Straightedge operation log`);
  }
  return parsed as OpLog;
}
