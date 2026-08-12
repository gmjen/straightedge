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
import type { Op, OpLog, OpLogV1, OpLogV2 } from "./types.js";

const EMPTY: OpLogV1 = { version: 1, ops: [] };
const V2_OPS = new Set(["style_nodes", "set_presentation", "apply_theme", "reroute_edges"]);

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
  if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.ops)) {
    throw new Error(`${path} must contain a version 1 or 2 operation log`);
  }
  return { log: parsed as OpLog, raw };
}

/** Backwards-compatible helper. New v2 operations promote the log automatically. */
export function writeLog(sourcePath: string, ops: Op[], preferredVersion?: 1 | 2): void {
  const version = preferredVersion ?? versionFor(ops);
  writeOpLog(sourcePath, version === 1
    ? { version: 1, ops: ops as OpLogV1["ops"] }
    : { version: 2, ops });
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
    makeLog(ops, snapshot.log.version === 2 || V2_OPS.has(op.op) ? 2 : 1),
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

export function versionFor(ops: Op[], preferred: 1 | 2 = 1): 1 | 2 {
  return preferred === 2 || ops.some((op) => V2_OPS.has(op.op)) ? 2 : 1;
}

export function makeLog(ops: Op[], preferred: 1 | 2 = 1): OpLog {
  return versionFor(ops, preferred) === 2
    ? { version: 2, ops }
    : { version: 1, ops: ops as OpLogV1["ops"] };
}
