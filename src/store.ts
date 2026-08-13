/** Versioned, atomic persistence for <name>.layout.json. */

import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Op, OpLog, OpLogV1 } from "./types.js";

const EMPTY: OpLogV1 = { version: 1, ops: [] };
const V2_OPS = new Set(["style_nodes", "set_presentation", "apply_theme", "reroute_edges"]);
const V3_OPS = new Set(["row_nodes", "stack_nodes"]);

export interface LogSnapshot {
  log: OpLog;
  raw: string | null;
}

export function logPathFor(sourcePath: string): string {
  return sourcePath.replace(/\.mmd$/, "") + ".layout.json";
}

export function readLog(sourcePath: string): OpLog {
  return readLogSnapshot(sourcePath).log;
}

export function readLogSnapshot(sourcePath: string): LogSnapshot {
  const path = logPathFor(sourcePath);
  if (!existsSync(path)) return { log: { ...EMPTY, ops: [] }, raw: null };

  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown; ops?: unknown };
  if ((parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) || !Array.isArray(parsed.ops)) {
    throw new Error(`${path} must contain a version 1, 2, or 3 operation log`);
  }
  return { log: parsed as OpLog, raw };
}

/** Backwards-compatible helper. New operations promote the log only when required. */
export function writeLog(sourcePath: string, ops: Op[], preferredVersion?: 1 | 2 | 3): void {
  const version = preferredVersion ?? versionFor(ops);
  writeOpLog(sourcePath, makeLog(ops, version));
}

export function writeOpLog(sourcePath: string, log: OpLog, expectedRaw?: string | null): void {
  const path = logPathFor(sourcePath);
  if (expectedRaw !== undefined) {
    const actual = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (actual !== expectedRaw) {
      throw new Error(`layout operation log changed during the transaction: ${path}`);
    }
  }

  const serialized = JSON.stringify(log, null, 2) + "\n";
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, serialized, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function appendOp(sourcePath: string, op: Op): Op[] {
  const snapshot = readLogSnapshot(sourcePath);
  const ops: Op[] = [...snapshot.log.ops, op];
  writeOpLog(
    sourcePath,
    makeLog(ops, Math.max(snapshot.log.version, minimumVersion(op)) as 1 | 2 | 3),
    snapshot.raw,
  );
  return ops;
}

export function popOp(sourcePath: string): Op[] {
  const snapshot = readLogSnapshot(sourcePath);
  const ops: Op[] = snapshot.log.ops.slice(0, -1);
  writeOpLog(sourcePath, makeLog(ops, snapshot.log.version), snapshot.raw);
  return ops;
}

export function deleteLog(sourcePath: string): void {
  rmSync(logPathFor(sourcePath), { force: true });
}

export function versionFor(ops: Op[], preferred: 1 | 2 | 3 = 1): 1 | 2 | 3 {
  return ops.reduce<1 | 2 | 3>((version, op) => Math.max(version, minimumVersion(op)) as 1 | 2 | 3, preferred);
}

export function makeLog(ops: Op[], preferred: 1 | 2 | 3 = 1): OpLog {
  const version = versionFor(ops, preferred);
  if (version === 3) return { version: 3, ops };
  if (version === 2) return { version: 2, ops };
  return { version: 1, ops: ops as OpLogV1["ops"] };
}

function minimumVersion(op: Op): 1 | 2 | 3 {
  if (V3_OPS.has(op.op) || (op.op === "distribute_nodes" && op.order !== undefined)) return 3;
  return V2_OPS.has(op.op) ? 2 : 1;
}
