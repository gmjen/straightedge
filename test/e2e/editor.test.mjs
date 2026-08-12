import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import puppeteer from "puppeteer";

import { startEditor } from "../../dist/editor.js";
import { readLog } from "../../dist/store.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("local editor drives resize, drag, undo/redo, and Mermaid source save through shared state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "straightedge-editor-e2e-"));
  const sourcePath = join(directory, "editor.mmd");
  writeFileSync(sourcePath, "flowchart LR\n  a[Alpha] --> b[Beta]\n");
  let editor;
  let browser;
  try {
    editor = await startEditor(sourcePath);
    const unauthorized = await fetch(new URL("/api/state", editor.url).origin + "/api/state");
    assert.equal(unauthorized.status, 403);

    browser = await puppeteer.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });
    const page = await browser.newPage();
    await page.goto(editor.url);
    await page.waitForSelector('[data-straightedge-node="a"]');
    assert.equal(await page.$eval("#status", (node) => node.textContent), "clean");

    await page.click('[data-straightedge-node="a"]');
    const originalWidth = Number(await page.$eval("#width", (input) => input.value));
    await page.$eval("#width", (input, value) => { input.value = String(value); }, originalWidth + 50);
    await page.click("#resize");
    await page.waitForFunction(() => document.querySelector("#ops")?.textContent?.includes("resize_node"));
    assert.equal(readLog(sourcePath).ops.at(-1)?.op, "resize_node");

    const node = await page.$('[data-straightedge-node="a"]');
    const box = await node.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 28, box.y + box.height / 2 + 12, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector("#ops")?.textContent?.includes("move_node"));
    assert.equal(readLog(sourcePath).ops.at(-1)?.op, "move_node");

    await page.click("#undo");
    await page.waitForFunction(() => !document.querySelector("#ops")?.textContent?.includes("move_node"));
    assert.equal(readLog(sourcePath).ops.at(-1)?.op, "resize_node");

    await page.click("#redo");
    await page.waitForFunction(() => document.querySelector("#ops")?.textContent?.includes("move_node"));
    assert.equal(readLog(sourcePath).ops.at(-1)?.op, "move_node");
    await page.click("#undo");
    await page.waitForFunction(() => !document.querySelector("#ops")?.textContent?.includes("move_node"));

    await page.$eval("#source", (textarea) => { textarea.value = "flowchart LR\n  a[Alpha] --> b[Beta] --> c[Gamma]\n"; });
    await page.click("#save");
    await page.waitForSelector('[data-straightedge-node="c"]');
    assert.match(await page.$eval("#source", (textarea) => textarea.value), /c\[Gamma\]/);
  } finally {
    if (browser) await browser.close();
    if (editor) await editor.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
