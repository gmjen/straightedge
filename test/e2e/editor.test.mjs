import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import puppeteer from "puppeteer";

import { startEditor } from "../../dist/editor.js";
import { browserLaunchOptions } from "../../dist/paint.js";
import { readLog } from "../../dist/store.js";

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
    const outside = await fetch(new URL("/api/file?path=/etc/passwd", editor.url).origin + "/api/file?path=/etc/passwd", {
      headers: { "x-straightedge-token": editor.token },
    });
    assert.equal(outside.status, 404, "the editor exposes no arbitrary file endpoint");
    assert.doesNotMatch(await outside.text(), /root:/);

    browser = await puppeteer.launch(browserLaunchOptions());
    const page = await browser.newPage();
    let dialogs = 0;
    page.on("dialog", async (dialog) => { dialogs += 1; await dialog.dismiss(); });
    await page.goto(editor.url);
    await page.waitForSelector('[data-straightedge-node="a"]');
    assert.notEqual(await page.$eval("#status", (node) => node.textContent), "failed");
    assert.equal(await page.$eval("#status", (node) => node.title), "No blocking problems were detected by the active checks.");

    await page.click('[data-straightedge-node="a"]');
    const originalWidth = Number(await page.$eval("#width", (input) => input.value));
    await page.$eval("#width", (input, value) => { input.value = String(value); }, originalWidth + 50);
    await page.$eval("#height", (input) => { input.value = ""; });
    await page.click("#resize");
    await page.waitForFunction(() => document.querySelector("#ops")?.textContent?.includes("resize_node"));
    assert.equal(readLog(sourcePath).ops.at(-1)?.op, "resize_node");
    assert.equal("height" in readLog(sourcePath).ops.at(-1), false, "blank dimensions are omitted");

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

    await page.$eval("#source", (textarea) => { textarea.value = "flowchart LR\n  a[Alpha] --> b[Beta] --> c((Circle Y))\n"; });
    await page.click("#save");
    await page.waitForSelector('[data-straightedge-node="c"]');
    assert.match(await page.$eval("#source", (textarea) => textarea.value), /c\(\(Circle Y\)\)/);

    await page.click('[data-straightedge-node="c"]');
    const circleWidth = Number(await page.$eval("#width", (input) => input.value));
    const resizedDiameter = Math.max(1, Math.round(circleWidth * 1.1));
    await page.$eval("#width", (input, value) => { input.value = String(value); input.dispatchEvent(new Event("input", { bubbles: true })); }, resizedDiameter);
    await page.$eval("#height", (input) => { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); });
    assert.match(await page.$eval("#resizeResolution", (node) => node.textContent), new RegExp(`${resizedDiameter} × ${resizedDiameter}`));
    const resizeResponse = page.waitForResponse((response) => response.url().includes("/api/transaction"));
    await page.click("#resize");
    const resizePayload = await (await resizeResponse).json();
    assert.equal(resizePayload.committed, true, resizePayload.reason);
    await page.waitForFunction((width) => JSON.parse(document.querySelector("#ops").textContent).at(-1)?.width === width, {}, resizedDiameter);
    const circleOp = readLog(sourcePath).ops.at(-1);
    assert.equal(circleOp.op, "resize_node");
    assert.equal("height" in circleOp, false);
    const circleState = await fetch(new URL("/api/state", editor.url).origin + "/api/state", { headers: { "x-straightedge-token": editor.token } }).then((response) => response.json());
    const circle = circleState.nodes.find((node) => node.id === "c");
    assert.equal(circle.width, circle.height, "one circle dimension resolves to both axes");

    await page.click('[data-straightedge-node="a"]');
    await page.keyboard.down("Shift");
    await page.click('[data-straightedge-node="b"]');
    await page.click('[data-straightedge-node="c"]');
    await page.keyboard.up("Shift");
    assert.deepEqual(await page.$$eval("#selection .chip", (nodes) => nodes.map((node) => node.textContent)), ["1 · a", "2 · b", "3 · c"]);
    await page.$eval("#gap", (input) => { input.value = "48"; });
    await page.click("#row");
    await page.waitForFunction(() => document.querySelector("#ops")?.textContent?.includes("row_nodes"));
    assert.deepEqual(readLog(sourcePath).ops.at(-1)?.nodes, ["a", "b", "c"]);
    assert.equal(readLog(sourcePath).version, 3);

    const beforeZoom = readFileSync(sourcePath.replace(/\.mmd$/, ".layout.json"), "utf8");
    await page.click("#zoomIn");
    assert.equal(await page.$eval("#zoomValue", (node) => node.textContent), "110%");
    await page.click("#zoomFit");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(await page.$eval("#canvas", (canvas) => {
      const bounds = canvas.getBoundingClientRect();
      return [...canvas.querySelectorAll("[data-straightedge-node]")].every((node) => {
        const box = node.getBoundingClientRect();
        return box.left >= bounds.left - 1 && box.right <= bounds.right + 1 && box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1;
      });
    }), true, "fit keeps every node inside the visible canvas viewport");
    await page.click("#zoomReset");
    assert.equal(await page.$eval("#zoomValue", (node) => node.textContent), "100%");
    assert.equal(readFileSync(sourcePath.replace(/\.mmd$/, ".layout.json"), "utf8"), beforeZoom, "zoom is viewport-only");

    const beforeKeyboardUndo = readLog(sourcePath).ops.length;
    await page.click("header strong");
    await page.keyboard.down("Control");
    await page.keyboard.press("z");
    await page.keyboard.up("Control");
    await page.waitForFunction((count) => JSON.parse(document.querySelector("#ops").textContent).length === count - 1, {}, beforeKeyboardUndo);
    assert.equal(readLog(sourcePath).ops.length, beforeKeyboardUndo - 1);

    const sourceBeforeDraft = readFileSync(sourcePath, "utf8");
    const sidecarBeforeNativeUndo = readFileSync(sourcePath.replace(/\.mmd$/, ".layout.json"), "utf8");
    await page.focus("#source");
    await page.keyboard.type(" ");
    assert.equal(await page.$eval("#dirtyState", (node) => node.hidden), false);
    await page.keyboard.down("Control");
    await page.keyboard.press("z");
    await page.keyboard.up("Control");
    assert.equal(readFileSync(sourcePath.replace(/\.mmd$/, ".layout.json"), "utf8"), sidecarBeforeNativeUndo, "textarea undo never invokes layout undo");

    const dirtyDraft = await page.$eval("#source", (textarea) => textarea.value + "\n%% unsaved draft");
    await page.$eval("#source", (textarea, value) => { textarea.value = value; textarea.dispatchEvent(new Event("input", { bubbles: true })); }, dirtyDraft);
    await page.click("#refresh");
    assert.equal(await page.$eval("#dirtyPanel", (node) => node.hidden), false);
    assert.equal(await page.$eval("#source", (textarea) => textarea.value), dirtyDraft);
    await page.click("#cancelApply");
    assert.equal(await page.$eval("#source", (textarea) => textarea.value), dirtyDraft);

    await page.click("#row");
    assert.equal(await page.$eval("#dirtyPanel", (node) => node.hidden), false, "layout changes are guarded while source is dirty");
    await page.click("#discardApply");
    await page.waitForFunction(() => document.querySelector("#ops")?.textContent?.includes("row_nodes"));
    assert.equal(await page.$eval("#source", (textarea) => textarea.value), sourceBeforeDraft);

    const diskBeforeInvalidSave = readFileSync(sourcePath, "utf8");
    await page.$eval("#source", (textarea) => { textarea.value = "not valid Mermaid"; textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.click("#save");
    await page.waitForFunction(() => document.querySelector("#error")?.hidden === false);
    assert.equal(readFileSync(sourcePath, "utf8"), diskBeforeInvalidSave, "invalid source save rolls disk bytes back");
    assert.equal(await page.$eval("#source", (textarea) => textarea.value), "not valid Mermaid");
    assert.equal(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true);

    await page.$eval("#source", (textarea, value) => { textarea.value = value; textarea.dispatchEvent(new Event("input", { bubbles: true })); }, diskBeforeInvalidSave);
    await page.click("#save");
    await page.waitForFunction(() => document.querySelector("#dirtyState")?.hidden === true);
    await page.click("#reset");
    await page.waitForFunction(() => document.querySelector("#resetPanel")?.hidden === false);
    assert.match(await page.$eval("#resetSummary", (node) => node.textContent), /operations, v3.*\.straightedge\/backups/);
    await page.click("#cancelReset");
    assert.equal(dialogs, 0, "expected editor flows use inline UI, not alert dialogs");

    const replayedOps = readLog(sourcePath).ops.length;
    await editor.close();
    editor = await startEditor(sourcePath);
    await page.goto(editor.url);
    await page.waitForSelector('[data-straightedge-node="c"]');
    assert.equal(JSON.parse(await page.$eval("#ops", (node) => node.textContent)).length, replayedOps, "restart replays the persisted editor history");
  } finally {
    if (browser) await browser.close();
    if (editor) await editor.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
