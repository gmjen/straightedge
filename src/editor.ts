import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import type { AddressInfo } from "node:net";
import type { Browser } from "puppeteer";
import { openBrowser } from "./paint.js";
import { render } from "./render.js";
import { structuredResult } from "./result.js";
import { parseOps } from "./schemas.js";
import { popOp, readLog, readLogSnapshot, writeOpLog } from "./store.js";
import { applyTransaction, repair } from "./transaction.js";
import type { Op } from "./types.js";

export interface EditorHandle {
  server: Server;
  url: string;
  token: string;
  close(): Promise<void>;
}

export async function startEditor(sourcePath: string, port = 0): Promise<EditorHandle> {
  const selected = resolvePath(sourcePath);
  if (!selected.endsWith(".mmd")) throw new Error("editor source must end in .mmd");
  // Fail before binding if the selected document cannot be rendered.
  const browser = await openBrowser();
  try {
    await render(selected, browser);
  } catch (error) {
    await browser.close();
    throw error;
  }
  const token = randomBytes(24).toString("hex");
  const redo: Op[] = [];
  const server = createServer((request, response) => void route(selected, token, browser, redo, request, response));
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
  } catch (error) {
    await browser.close();
    throw error;
  }
  const address = server.address() as AddressInfo;
  return {
    server,
    token,
    url: `http://127.0.0.1:${address.port}/?token=${token}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await browser.close();
    },
  };
}

async function route(sourcePath: string, token: string, browser: Browser, redo: Op[], request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!authorized(url, request, token)) return json(response, 403, { error: "invalid editor session token" });
    securityHeaders(response);

    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(editorHtml(token, basename(sourcePath)));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      return json(response, 200, await editorState(sourcePath, browser));
    }
    if (request.method === "POST" && url.pathname === "/api/transaction") {
      const body = await bodyJson(request);
      const ops = parseOps((body as { ops?: unknown }).ops);
      const transaction = await applyTransaction(sourcePath, ops, { browser });
      if (transaction.committed) redo.length = 0;
      return json(response, transaction.committed ? 200 : 422, {
        committed: transaction.committed,
        appliedOps: transaction.appliedOps,
        reason: transaction.reason,
        state: await stateFromResult(sourcePath, transaction.result),
      });
    }
    if (request.method === "POST" && url.pathname === "/api/repair") {
      const repaired = await repair(sourcePath, 3, browser);
      if (repaired.committed) redo.length = 0;
      return json(response, 200, {
        committed: repaired.committed,
        appliedOps: repaired.appliedOps,
        reason: repaired.reason,
        state: await stateFromResult(sourcePath, repaired.result),
      });
    }
    if (request.method === "POST" && url.pathname === "/api/undo") {
      const snapshot = readLogSnapshot(sourcePath);
      const undone = snapshot.log.ops.at(-1);
      if (!undone) return json(response, 200, await editorState(sourcePath, browser));
      popOp(sourcePath);
      try {
        const state = await editorState(sourcePath, browser);
        redo.push(undone);
        return json(response, 200, state);
      } catch (error) {
        writeOpLog(sourcePath, snapshot.log);
        throw error;
      }
    }
    if (request.method === "POST" && url.pathname === "/api/redo") {
      const operation = redo.pop();
      if (!operation) return json(response, 200, await editorState(sourcePath, browser));
      const transaction = await applyTransaction(sourcePath, [operation], { browser });
      if (!transaction.committed) redo.push(operation);
      return json(response, transaction.committed ? 200 : 422, await stateFromResult(sourcePath, transaction.result));
    }
    if (request.method === "POST" && url.pathname === "/api/source") {
      const body = await bodyJson(request) as { source?: unknown };
      if (typeof body.source !== "string" || body.source.length === 0) throw new Error("source must be a non-empty string");
      const original = readFileSync(sourcePath, "utf8");
      writeAtomic(sourcePath, body.source.endsWith("\n") ? body.source : `${body.source}\n`);
      try {
        const state = await editorState(sourcePath, browser);
        redo.length = 0;
        return json(response, 200, state);
      } catch (error) {
        writeAtomic(sourcePath, original);
        throw error;
      }
    }
    json(response, 404, { error: "not found" });
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function editorState(sourcePath: string, browser: Browser) {
  return stateFromResult(sourcePath, await render(sourcePath, browser));
}

async function stateFromResult(sourcePath: string, result: Awaited<ReturnType<typeof render>>) {
  return {
    source: readFileSync(sourcePath, "utf8"),
    svg: result.svg,
    opLog: readLog(sourcePath),
    ...structuredResult(result),
  };
}

function authorized(url: URL, request: IncomingMessage, token: string): boolean {
  return url.searchParams.get("token") === token || request.headers["x-straightedge-token"] === token;
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
}

async function bodyJson(request: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) {
    text += String(chunk);
    if (text.length > 1_000_000) throw new Error("request body is too large");
  }
  return JSON.parse(text || "{}");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function writeAtomic(path: string, contents: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, contents, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function editorHtml(token: string, name: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Straightedge — ${escapeHtml(name)}</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f4f6fa}*{box-sizing:border-box}body{margin:0;height:100vh;display:grid;grid-template-rows:52px 1fr}header{display:flex;align-items:center;gap:12px;padding:0 18px;background:#172033;color:white}header strong{margin-right:auto}.status{font-size:13px;padding:5px 9px;border-radius:999px;background:#334155}.status.clean{background:#047857}.status.failed{background:#b91c1c}.status.review{background:#b45309}main{display:grid;grid-template-columns:minmax(260px,28%) 1fr minmax(280px,30%);min-height:0}.panel{padding:14px;border-right:1px solid #d8dee9;background:white;min-height:0;overflow:auto}.panel:last-child{border-right:0;border-left:1px solid #d8dee9}textarea{width:100%;height:calc(100% - 48px);resize:none;border:1px solid #cbd5e1;border-radius:8px;padding:12px;font:13px/1.5 ui-monospace,monospace}button,input,select{font:inherit}button{border:0;border-radius:7px;padding:8px 11px;background:#2563eb;color:white;cursor:pointer}button.secondary{background:#e2e8f0;color:#172033}.toolbar{display:flex;gap:7px;margin-bottom:10px;flex-wrap:wrap}.canvas{overflow:auto;display:grid;place-items:center;padding:26px;background-color:#edf1f7;background-image:linear-gradient(#dfe5ee 1px,transparent 1px),linear-gradient(90deg,#dfe5ee 1px,transparent 1px);background-size:20px 20px}.canvas svg{max-width:100%;height:auto;box-shadow:0 12px 34px #52607535}.canvas [data-straightedge-node]{cursor:grab}.canvas [data-straightedge-node].selected .label-container{stroke:#2563eb!important;stroke-width:3px!important}.problem{border:1px solid #d8dee9;border-left:4px solid #d97706;border-radius:7px;padding:9px;margin:8px 0;font-size:13px;cursor:pointer}.problem.error{border-left-color:#dc2626}.problem code{display:block;color:#64748b;margin-top:4px}.ops{font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap;background:#f8fafc;padding:9px;border-radius:7px}.field{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:8px 0}.field input,.field select{width:100%;padding:7px;border:1px solid #cbd5e1;border-radius:6px}h3{font-size:14px;margin:18px 0 8px}.hint{font-size:12px;color:#64748b;margin:6px 0 12px}
</style></head><body>
<header><strong>Straightedge · ${escapeHtml(name)}</strong><span id="selection">No selection</span><span id="status" class="status">Loading</span></header>
<main><section class="panel"><div class="toolbar"><button id="save">Save source</button><button id="refresh" class="secondary">Refresh</button></div><textarea id="source" spellcheck="false"></textarea></section>
<section id="canvas" class="canvas"></section>
<section class="panel"><div class="toolbar"><button id="undo" class="secondary">Undo</button><button id="redo" class="secondary">Redo</button><button id="repair">Safe repair</button></div><p class="hint">Click nodes to select; Shift-click adds to the selection. Drag a node to record a relative move.</p>
<h3>Resize selected</h3><div class="field"><input id="width" type="number" min="1" placeholder="Width"><input id="height" type="number" min="1" placeholder="Height"></div><button id="resize" class="secondary">Resize</button>
<h3>Align selection</h3><div class="field"><select id="alignEdge"><option>top</option><option>bottom</option><option>left</option><option>right</option><option>centerX</option><option>centerY</option></select><button id="align" class="secondary">Align</button></div>
<h3>Distribute selection</h3><div class="field"><select id="axis"><option>horizontal</option><option>vertical</option></select><input id="gap" type="number" min="0" placeholder="Gap"></div><button id="distribute" class="secondary">Distribute</button>
<h3>Problems</h3><div id="problems"></div><h3>Operation log</h3><div id="ops" class="ops"></div></section></main>
<script>
const token=${JSON.stringify(token)};let state;let selected=[];const q=s=>document.querySelector(s);const api=async(path,options={})=>{const response=await fetch(path,{...options,headers:{'content-type':'application/json','x-straightedge-token':token,...options.headers}});const data=await response.json();if(!response.ok)throw new Error(data.error||data.reason||'Request failed');return data};
async function load(){try{state=await api('/api/state');draw()}catch(error){alert(error.message)}}
function draw(){q('#source').value=state.source;q('#canvas').innerHTML=state.svg;q('#status').textContent=state.status;q('#status').className='status '+state.status;q('#ops').textContent=JSON.stringify(state.opLog.ops,null,2);q('#problems').innerHTML=state.problems.map((p,i)=>'<div class="problem '+p.severity+'" data-problem="'+i+'"><strong>'+escapeText(p.message)+'</strong><code>'+p.kind+'</code></div>').join('')||'<span class="hint">No visual problems.</span>';selected=selected.filter(id=>state.nodes.some(n=>n.id===id));bindCanvas();updateSelection()}
function bindCanvas(){q('#canvas').querySelectorAll('[data-straightedge-node]').forEach(el=>{const id=el.dataset.straightedgeNode;el.addEventListener('click',event=>{event.stopPropagation();if(event.shiftKey){selected=selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]}else selected=[id];updateSelection()});let origin;el.addEventListener('pointerdown',event=>{origin={x:event.clientX,y:event.clientY};el.setPointerCapture(event.pointerId)});el.addEventListener('pointerup',async event=>{if(!origin)return;const scale=state.frame?.contentScale||1;const dx=(event.clientX-origin.x)/scale,dy=(event.clientY-origin.y)/scale;origin=null;if(Math.hypot(dx,dy)<3)return;await transact([{op:'move_node',node:id,dx,dy}])})});q('#problems').querySelectorAll('[data-problem]').forEach(el=>el.onclick=()=>{selected=state.problems[Number(el.dataset.problem)].nodes||[];updateSelection()})}
function updateSelection(){q('#selection').textContent=selected.length?selected.join(', '):'No selection';q('#canvas').querySelectorAll('[data-straightedge-node]').forEach(el=>el.classList.toggle('selected',selected.includes(el.dataset.straightedgeNode)));if(selected.length===1){const n=state.nodes.find(n=>n.id===selected[0]);q('#width').value=Math.round(n.width);q('#height').value=Math.round(n.height)}}
async function transact(ops){try{const result=await api('/api/transaction',{method:'POST',body:JSON.stringify({ops})});state=result.state;draw()}catch(error){alert(error.message);await load()}}
q('#save').onclick=async()=>{try{state=await api('/api/source',{method:'POST',body:JSON.stringify({source:q('#source').value})});draw()}catch(error){alert(error.message)}};q('#refresh').onclick=load;q('#undo').onclick=async()=>{state=await api('/api/undo',{method:'POST'});draw()};q('#redo').onclick=async()=>{state=await api('/api/redo',{method:'POST'});draw()};q('#repair').onclick=async()=>{const result=await api('/api/repair',{method:'POST'});state=result.state;draw()};q('#resize').onclick=()=>{if(selected.length!==1)return alert('Select one node');const width=Number(q('#width').value),height=Number(q('#height').value);transact([{op:'resize_node',node:selected[0],width,height}])};q('#align').onclick=()=>selected.length<2?alert('Select at least two nodes'):transact([{op:'align_nodes',nodes:selected,edge:q('#alignEdge').value}]);q('#distribute').onclick=()=>selected.length<2?alert('Select at least two nodes'):transact([{op:'distribute_nodes',nodes:selected,axis:q('#axis').value,...(q('#gap').value?{gap:Number(q('#gap').value)}:{})}]);q('#canvas').onclick=()=>{selected=[];updateSelection()};
function escapeText(value){const div=document.createElement('div');div.textContent=value;return div.innerHTML}load();
</script></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}
