import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const work = mkdtempSync(join(tmpdir(), "straightedge-package-"));
const cache = join(work, "npm-cache");
const consumer = join(work, "consumer");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (command, args, options = {}) => {
  const { accept: accepted = [0], ...spawnOptions } = options;
  const result = spawnSync(command, args, { encoding: "utf8", ...spawnOptions });
  assert.ok(accepted.includes(result.status), `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  return result;
};

try {
  mkdirSync(cache, { recursive: true });
  mkdirSync(consumer, { recursive: true });
  const environment = { ...process.env, npm_config_cache: cache };
  const packed = run(npm, ["pack", "--json", "--pack-destination", work], { cwd: root, env: environment });
  const jsonStart = Math.max(packed.stdout.lastIndexOf("\n["), packed.stdout.startsWith("[") ? 0 : -1);
  assert.ok(jsonStart >= 0, `npm pack did not return JSON:\n${packed.stdout}`);
  const manifest = JSON.parse(packed.stdout.slice(jsonStart === 0 ? 0 : jsonStart + 1))[0];
  const names = manifest.files.map((file) => file.path);
  for (const required of ["README.md", "LICENSE", "SPEC.md", "dist/index.js", "dist/index.d.ts", "dist/cli.js"]) {
    assert.ok(names.includes(required), `tarball is missing ${required}`);
  }
  assert.equal(names.some((name) => /(^|\/)(node_modules|test|coverage|\.straightedge)(\/|$)|\.DS_Store$|\.tgz$/.test(name)), false);
  if (manifest.size > 100_000 || manifest.entryCount > 100) {
    console.warn(`Package budget warning: ${manifest.size} compressed bytes across ${manifest.entryCount} files.`);
  }

  const tarball = join(work, manifest.filename);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "straightedge-consumer", private: true, type: "module" }, null, 2));
  run(npm, ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: consumer, env: environment });
  const installed = join(consumer, "node_modules", "straightedge");
  const cli = join(installed, "dist", "cli.js");
  assert.match(readFileSync(cli, "utf8"), /^#!\/usr\/bin\/env node/);
  assert.ok((statSync(cli).mode & 0o111) !== 0, "packed CLI must be executable");

  run(process.execPath, [cli, "--version"], { cwd: consumer });
  run(process.execPath, [cli, "doctor", "--json"], { cwd: consumer });
  const fixture = join(consumer, "fixture.mmd");
  writeFileSync(fixture, "flowchart LR\n  start[Start] --> done[Done]\n");
  run(process.execPath, [cli, "render", fixture], { cwd: consumer, accept: [0, 1] });
  run(process.execPath, [cli, "check", fixture, "--json"], { cwd: consumer, accept: [0, 1] });
  run(process.execPath, ["--input-type=module", "-e", "import('straightedge').then(m=>{if(!m.render)process.exit(1)})"], { cwd: consumer });

  writeFileSync(join(consumer, "index.mts"), "import { render } from 'straightedge';\nvoid render;\n");
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true }, include: ["index.mts"] }, null, 2));
  run(join(root, "node_modules", ".bin", "tsc"), ["-p", join(consumer, "tsconfig.json")], { cwd: consumer });

  const textFiles = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:js|d\.ts|map|json|md)$/.test(entry.name)) textFiles.push(path);
    }
  };
  visit(installed);
  for (const path of textFiles) {
    const contents = readFileSync(path, "utf8");
    assert.doesNotMatch(contents, /\/Users\/greg|\.codex\/attachments|pasted-text\.txt/, `private local path leaked into ${basename(path)}`);
  }
  console.log(`Package smoke passed: ${manifest.filename}, ${manifest.size} bytes, ${manifest.entryCount} files.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
