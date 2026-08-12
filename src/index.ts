/**
 * Public surface. Domain operations remain thin; the CLI, MCP server, and editor
 * all call these same functions.
 */

export * from "./types.js";
export { replay } from "./replay.js";
export { applyOp } from "./ops.js";
export { lint } from "./lint.js";
export { normalize, PADDING } from "./canvas.js";
export { render, resolve, renderWithOps, statusOf } from "./render.js";
export { applyTransaction, repair } from "./transaction.js";
export { startEditor } from "./editor.js";
export { PRESETS } from "./presentation.js";
export { THEMES } from "./themes.js";
