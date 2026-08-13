import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { browserLaunchOptions } from "../src/paint.js";

const originalNoSandbox = process.env.STRAIGHTEDGE_CHROMIUM_NO_SANDBOX;

afterEach(() => {
  if (originalNoSandbox === undefined) delete process.env.STRAIGHTEDGE_CHROMIUM_NO_SANDBOX;
  else process.env.STRAIGHTEDGE_CHROMIUM_NO_SANDBOX = originalNoSandbox;
});

test("Chromium sandbox remains enabled by default", () => {
  delete process.env.STRAIGHTEDGE_CHROMIUM_NO_SANDBOX;
  assert.equal(browserLaunchOptions().args, undefined);
});

test("trusted CI can explicitly opt out of the Chromium sandbox", () => {
  process.env.STRAIGHTEDGE_CHROMIUM_NO_SANDBOX = "1";
  assert.deepEqual(browserLaunchOptions().args, ["--no-sandbox", "--disable-setuid-sandbox"]);
});
