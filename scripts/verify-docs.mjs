import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const required = [
  "LICENSE",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "CHANGELOG.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/diagram_quality.yml",
  ".github/pull_request_template.md",
  "docs/assets/pipeline-before.png",
  "docs/assets/pipeline-layout.png",
  "docs/assets/pipeline-after.png",
  "docs/assets/pipeline-after.layout.json",
  "docs/assets/review-gate-before.png",
  "docs/assets/review-gate-after.png",
  "docs/assets/review-gate-after.layout.json",
];
for (const path of required) assert.ok(existsSync(resolve(root, path)), `missing required OSS file: ${path}`);

for (const markdown of ["README.md", "CONTRIBUTING.md", "SECURITY.md"]) {
  const contents = readFileSync(resolve(root, markdown), "utf8");
  for (const match of contents.matchAll(/\]\((?!https?:|mailto:|#)([^)#]+)(?:#[^)]+)?\)/g)) {
    assert.ok(existsSync(resolve(root, dirname(markdown), match[1])), `${markdown} has a broken link: ${match[1]}`);
  }
}

const readPngSize = (path) => {
  const bytes = readFileSync(resolve(root, path));
  assert.equal(bytes.subarray(1, 4).toString(), "PNG", `${path} is not a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};
assert.deepEqual(readPngSize("docs/assets/pipeline-before.png"), [694, 132]);
assert.deepEqual(readPngSize("docs/assets/pipeline-layout.png"), [540, 266]);
assert.deepEqual(readPngSize("docs/assets/pipeline-after.png"), [1200, 630]);
assert.deepEqual(readPngSize("docs/assets/review-gate-before.png"), [720, 240]);
assert.deepEqual(readPngSize("docs/assets/review-gate-after.png"), [720, 240]);

const publicText = ["README.md", "package.json", "CONTRIBUTING.md", "SECURITY.md"]
  .map((path) => readFileSync(resolve(root, path), "utf8"))
  .join("\n");
assert.doesNotMatch(publicText, /<owner>|\/Users\/|\.codex\/attachments/);
console.log("OSS documentation, links, assets, and public metadata verified.");
