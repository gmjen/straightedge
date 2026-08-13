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
import { readLog } from "./store.js";
import { applyTransaction, repair, resetLayout, undoTransaction } from "./transaction.js";
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
    securityHeaders(response);
    if (!authorized(url, request, token)) return json(response, 403, { error: "invalid editor session token" });

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
      const transaction = await undoTransaction(sourcePath, browser);
      if (transaction.removed) redo.push(transaction.removed);
      return json(response, 200, await stateFromResult(sourcePath, transaction.result));
    }
    if (request.method === "POST" && url.pathname === "/api/redo") {
      const operation = redo.pop();
      if (!operation) return json(response, 200, await editorState(sourcePath, browser));
      const transaction = await applyTransaction(sourcePath, [operation], { browser });
      if (!transaction.committed) redo.push(operation);
      return json(response, transaction.committed ? 200 : 422, await stateFromResult(sourcePath, transaction.result));
    }
    if (request.method === "POST" && url.pathname === "/api/reset") {
      const body = await bodyJson(request) as { confirm?: unknown };
      const reset = await resetLayout(sourcePath, { confirm: body.confirm === true, browser });
      if (reset.committed) redo.length = 0;
      return json(response, 200, {
        committed: reset.committed,
        path: reset.path,
        operationCount: reset.operationCount,
        version: reset.version,
        backupPath: reset.backupPath,
        candidate: structuredResult(reset.result),
        ...(reset.committed ? { state: await editorState(sourcePath, browser) } : {}),
      });
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
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f4f6fa}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;height:100vh;display:grid;grid-template-rows:52px 1fr}header{display:flex;align-items:center;gap:12px;padding:0 18px;background:#172033;color:white}header strong{margin-right:auto}.status{font-size:13px;padding:5px 9px;border-radius:999px;background:#334155}.status.clean{background:#047857}.status.failed{background:#b91c1c}.status.review{background:#b45309}main{display:grid;grid-template-columns:minmax(260px,28%) 1fr minmax(280px,30%);min-height:0}.panel{padding:14px;border-right:1px solid #d8dee9;background:white;min-height:0;overflow:auto}.panel:last-child{border-right:0;border-left:1px solid #d8dee9}textarea{width:100%;height:calc(100% - 48px);resize:none;border:1px solid #cbd5e1;border-radius:8px;padding:12px;font:13px/1.5 ui-monospace,monospace}textarea.dirty{border-color:#d97706;box-shadow:0 0 0 2px #fef3c7}button,input,select{font:inherit}button{border:0;border-radius:7px;padding:8px 11px;background:#2563eb;color:white;cursor:pointer}button.secondary{background:#e2e8f0;color:#172033}button.danger{background:#b45309}button:disabled{opacity:.48;cursor:not-allowed}.toolbar{display:flex;gap:7px;margin-bottom:10px;flex-wrap:wrap}.canvas{overflow:auto;display:grid;place-items:center;padding:26px;background-color:#edf1f7;background-image:linear-gradient(#dfe5ee 1px,transparent 1px),linear-gradient(90deg,#dfe5ee 1px,transparent 1px);background-size:20px 20px}.artboard-shell{position:relative}.artboard{position:absolute;inset:0 auto auto 0;transform-origin:top left;transition:transform .12s ease}.canvas svg{max-width:none;height:auto;box-shadow:0 12px 34px #52607535}.canvas [data-straightedge-node]{cursor:grab}.canvas [data-straightedge-node].selected .label-container{stroke:#2563eb!important;stroke-width:3px!important}.problem{border:1px solid #d8dee9;border-left:4px solid #d97706;border-radius:7px;padding:9px;margin:8px 0;font-size:13px;cursor:pointer}.problem.error{border-left-color:#dc2626}.problem code{display:block;color:#64748b;margin-top:4px}.ops{font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap;background:#f8fafc;padding:9px;border-radius:7px}.field{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:8px 0}.field input,.field select{width:100%;padding:7px;border:1px solid #cbd5e1;border-radius:6px}h3{font-size:14px;margin:18px 0 8px}.hint{font-size:12px;color:#64748b;margin:6px 0 12px}.error{padding:9px;margin:8px 0;border-radius:7px;background:#fee2e2;color:#991b1b;font-size:13px}.dirty-panel{padding:10px;margin:8px 0;border:1px solid #f59e0b;border-radius:8px;background:#fffbeb}.dirty-panel strong{display:block;margin-bottom:8px}.dirty-state{font-size:12px;color:#92400e;padding:5px 0}.selection{display:flex;gap:5px;align-items:center;flex-wrap:wrap;font-size:12px}.chip{padding:3px 7px;border-radius:999px;background:#334155;color:white}.zoom{position:absolute;z-index:2;top:64px;left:calc(28% + 12px);display:flex;align-items:center;gap:6px;padding:5px;border-radius:8px;background:#ffffffdd;box-shadow:0 2px 10px #3341552b}.zoom button{padding:5px 9px}.zoom span{font:12px ui-monospace,monospace;min-width:42px;text-align:center}
</style></head><body>
<header><strong>Straightedge · ${escapeHtml(name)}</strong><span id="selection" class="selection">No selection</span><span id="status" class="status">Loading</span></header>
<main><section class="panel"><div class="toolbar"><button id="save">Save source</button><button id="refresh" class="secondary">Refresh</button></div><div id="dirtyState" class="dirty-state" hidden>Unsaved source</div><div id="error" class="error" role="alert" hidden></div><div id="dirtyPanel" class="dirty-panel" hidden><strong>Source has unsaved changes.</strong><div class="toolbar"><button id="saveApply">Save and apply</button><button id="discardApply" class="danger">Discard and apply</button><button id="cancelApply" class="secondary">Cancel</button></div></div><textarea id="source" aria-label="Mermaid source" spellcheck="false"></textarea></section>
<section id="canvas" class="canvas" aria-label="Diagram canvas"></section><div class="zoom" aria-label="Canvas zoom"><button id="zoomOut" class="secondary" aria-label="Zoom out">−</button><button id="zoomReset" class="secondary">100%</button><button id="zoomFit" class="secondary">Fit</button><span id="zoomValue">100%</span><button id="zoomIn" class="secondary" aria-label="Zoom in">+</button></div>
<section class="panel"><div class="toolbar"><button id="undo" class="secondary">Undo</button><button id="redo" class="secondary">Redo</button><button id="repair">Safe repair</button><button id="reset" class="danger">Reset layout</button></div><div id="resetPanel" class="dirty-panel" hidden><strong id="resetSummary"></strong><div class="toolbar"><button id="confirmReset" class="danger">Reset and create backup</button><button id="cancelReset" class="secondary">Cancel</button></div></div><p class="hint">Click nodes to select; Shift-click adds to the selection. Drag a node to record a relative move.</p>
<h3>Resize selected</h3><div class="field"><input id="width" aria-label="Node width" type="number" min="1" placeholder="Width (unchanged if blank)"><input id="height" aria-label="Node height" type="number" min="1" placeholder="Height (unchanged if blank)"></div><button id="resize" class="secondary">Resize</button><p id="resizeResolution" class="hint">A single circle dimension is applied to both axes.</p>
<h3>Align selection</h3><div class="field"><select id="alignEdge"><option>top</option><option>bottom</option><option>left</option><option>right</option><option>centerX</option><option>centerY</option></select><button id="align" class="secondary">Align</button></div>
<h3>Arrange in selection order</h3><div class="field"><select id="axis"><option>horizontal</option><option>vertical</option></select><input id="gap" type="number" min="0" placeholder="Gap (32 default)"></div><div class="toolbar"><button id="distribute" class="secondary">Distribute</button><button id="row" class="secondary">Row</button><button id="stack" class="secondary">Stack</button></div>
<h3>Problems</h3><div id="problems"></div><h3>Operation log</h3><div id="ops" class="ops"></div></section></main>
<script>
const token=${JSON.stringify(token)};let state;let selected=[];let dirty=false;let pendingAction=null;let zoom=1;const q=s=>document.querySelector(s);const api=async(path,options={})=>{const response=await fetch(path,{...options,headers:{'content-type':'application/json','x-straightedge-token':token,...options.headers}});const data=await response.json();if(!response.ok){const error=new Error(data.error||data.reason||'Request failed');error.details=data;throw error}return data};
function showError(error){const details=error?.details?.state?.problems||[];const evidence=details.length?' ('+details.map(problem=>problem.kind).join(', ')+')':'';q('#error').textContent=(error instanceof Error?error.message:String(error))+evidence;q('#error').hidden=false}function clearError(){q('#error').hidden=true;q('#error').textContent=''}
async function load(forceSource=false){try{clearError();state=await api('/api/state');draw(forceSource)}catch(error){showError(error)}}
function draw(forceSource=false){if(forceSource||!dirty)q('#source').value=state.source;q('#source').classList.toggle('dirty',dirty);q('#dirtyState').hidden=!dirty;q('#canvas').innerHTML='<div id="artboardShell" class="artboard-shell"><div id="artboard" class="artboard">'+state.svg+'</div></div>';applyZoom();q('#status').textContent=state.status;q('#status').className='status '+state.status;q('#status').title=state.check?.claim||'';q('#ops').textContent=JSON.stringify(state.opLog.ops,null,2);q('#problems').innerHTML=state.problems.map((p,i)=>'<div class="problem '+p.severity+'" data-problem="'+i+'"><strong>'+escapeText(p.message)+'</strong><code>'+p.kind+'</code></div>').join('')||'<span class="hint">No problems detected by the active checks.</span>';selected=selected.filter(id=>state.nodes.some(n=>n.id===id));bindCanvas();updateSelection()}
function bindCanvas(){q('#canvas').querySelectorAll('[data-straightedge-node]').forEach(el=>{const id=el.dataset.straightedgeNode;el.addEventListener('click',event=>{event.stopPropagation();if(event.shiftKey){selected=selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]}else selected=[id];updateSelection()});let origin;el.addEventListener('pointerdown',event=>{origin={x:event.clientX,y:event.clientY};el.setPointerCapture(event.pointerId)});el.addEventListener('pointerup',event=>{if(!origin)return;const scale=(state.frame?.contentScale||1)*zoom;const dx=(event.clientX-origin.x)/scale,dy=(event.clientY-origin.y)/scale;origin=null;if(Math.hypot(dx,dy)<3)return;queueLayout(()=>transact([{op:'move_node',node:id,dx,dy}]))})});q('#problems').querySelectorAll('[data-problem]').forEach(el=>el.onclick=()=>{selected=state.problems[Number(el.dataset.problem)].nodes||[];updateSelection()})}
function updateSelection(fillDimensions=true){q('#selection').innerHTML=selected.length?selected.map((id,index)=>'<span class="chip">'+(index+1)+' · '+escapeText(id)+'</span>').join(''):'No selection';q('#canvas').querySelectorAll('[data-straightedge-node]').forEach(el=>el.classList.toggle('selected',selected.includes(el.dataset.straightedgeNode)));if(fillDimensions&&selected.length===1){const n=state.nodes.find(n=>n.id===selected[0]);q('#width').value=Math.round(n.width);q('#height').value=Math.round(n.height)}q('#resize').disabled=selected.length!==1;for(const id of ['#align','#distribute','#row','#stack'])q(id).disabled=selected.length<2;updateResizeResolution()}
function queueLayout(action){clearError();if(dirty){pendingAction=action;q('#dirtyPanel').hidden=false;return}void action()}
async function transact(ops){try{const result=await api('/api/transaction',{method:'POST',body:JSON.stringify({ops})});state=result.state;draw()}catch(error){if(error?.details?.state){state=error.details.state;draw()}showError(error)}}
async function saveSource(){try{clearError();state=await api('/api/source',{method:'POST',body:JSON.stringify({source:q('#source').value})});dirty=false;draw(true);return true}catch(error){showError(error);return false}}
async function finishDirty(choice){const action=pendingAction;pendingAction=null;q('#dirtyPanel').hidden=true;if(!action)return;if(choice==='cancel')return;if(choice==='save'&&!await saveSource())return;if(choice==='discard'){dirty=false;q('#source').value=state.source;q('#source').classList.remove('dirty');q('#dirtyState').hidden=true}await action()}
async function simple(path){try{clearError();const result=await api(path,{method:'POST'});state=result.state||result;draw()}catch(error){showError(error)}}
async function previewReset(){try{clearError();const result=await api('/api/reset',{method:'POST',body:'{}'});q('#resetSummary').textContent='Reset '+result.path+' ('+result.operationCount+' operations, v'+result.version+'). Backup: '+(result.backupPath||'none');q('#resetPanel').hidden=false}catch(error){showError(error)}}async function confirmReset(){try{clearError();const result=await api('/api/reset',{method:'POST',body:JSON.stringify({confirm:true})});state=result.state;q('#resetPanel').hidden=true;selected=[];draw()}catch(error){showError(error)}}
function requireSelection(count,message){if(selected.length>=count)return true;showError(message);return false}function gap(){const value=q('#gap').value.trim();return value?Number(value):32}
function resize(){if(!requireSelection(1,'Select one node'))return;if(selected.length!==1){showError('Select exactly one node');return}const widthText=q('#width').value.trim(),heightText=q('#height').value.trim();if(!widthText&&!heightText){showError('Enter a width, a height, or both');return}const width=widthText?Number(widthText):undefined,height=heightText?Number(heightText):undefined;if((width!==undefined&&(!Number.isFinite(width)||width<=0))||(height!==undefined&&(!Number.isFinite(height)||height<=0))){showError('Dimensions must be positive numbers');return}queueLayout(()=>transact([{op:'resize_node',node:selected[0],...(width===undefined?{}:{width}),...(height===undefined?{}:{height})}]))}
function arrange(op){if(!requireSelection(2,'Select at least two nodes'))return;queueLayout(()=>transact([{op,nodes:selected,gap:gap(),...(op==='row_nodes'?{align:'center'}:{align:'center'})}]))}
function naturalSize(){const svg=q('#artboard svg');return svg?{width:Number(svg.getAttribute('width'))||svg.getBoundingClientRect().width/zoom,height:Number(svg.getAttribute('height'))||svg.getBoundingClientRect().height/zoom}:{width:0,height:0}}function applyZoom(){const artboard=q('#artboard'),shell=q('#artboardShell'),size=naturalSize();if(artboard)artboard.style.transform='scale('+zoom+')';if(shell){shell.style.width=size.width*zoom+'px';shell.style.height=size.height*zoom+'px'}q('#zoomValue').textContent=Math.round(zoom*100)+'%'}
function updateResizeResolution(){const n=selected.length===1?state.nodes.find(node=>node.id===selected[0]):undefined;const width=q('#width').value.trim(),height=q('#height').value.trim();q('#resizeResolution').textContent=n?.shape==='circle'&&Boolean(width)!==Boolean(height)?'Resolved circle size: '+(width||height)+' × '+(width||height):'A single circle dimension is applied to both axes.'}
function fitZoom(){const canvas=q('#canvas'),size=naturalSize();if(!canvas||!size.width||!size.height)return;zoom=Math.max(.25,Math.min(2,.9*Math.min((canvas.clientWidth-52)/size.width,(canvas.clientHeight-52)/size.height)));applyZoom()}
q('#source').addEventListener('input',()=>{dirty=true;q('#source').classList.add('dirty');q('#dirtyState').hidden=false});q('#width').addEventListener('input',updateResizeResolution);q('#height').addEventListener('input',updateResizeResolution);q('#save').onclick=()=>void saveSource();q('#refresh').onclick=()=>queueLayout(()=>load(true));q('#saveApply').onclick=()=>void finishDirty('save');q('#discardApply').onclick=()=>void finishDirty('discard');q('#cancelApply').onclick=()=>void finishDirty('cancel');q('#undo').onclick=()=>queueLayout(()=>simple('/api/undo'));q('#redo').onclick=()=>queueLayout(()=>simple('/api/redo'));q('#repair').onclick=()=>queueLayout(()=>simple('/api/repair'));q('#reset').onclick=()=>queueLayout(previewReset);q('#confirmReset').onclick=()=>void confirmReset();q('#cancelReset').onclick=()=>{q('#resetPanel').hidden=true};q('#resize').onclick=resize;q('#align').onclick=()=>requireSelection(2,'Select at least two nodes')&&queueLayout(()=>transact([{op:'align_nodes',nodes:selected,edge:q('#alignEdge').value}]));q('#distribute').onclick=()=>requireSelection(2,'Select at least two nodes')&&queueLayout(()=>transact([{op:'distribute_nodes',nodes:selected,axis:q('#axis').value,order:'given',...(q('#gap').value.trim()?{gap:Number(q('#gap').value)}:{})}]));q('#row').onclick=()=>arrange('row_nodes');q('#stack').onclick=()=>arrange('stack_nodes');q('#canvas').onclick=()=>{selected=[];updateSelection()};q('#zoomOut').onclick=()=>{zoom=Math.max(.5,Math.round((zoom-.1)*10)/10);applyZoom()};q('#zoomReset').onclick=()=>{zoom=1;applyZoom()};q('#zoomFit').onclick=fitZoom;q('#zoomIn').onclick=()=>{zoom=Math.min(2,Math.round((zoom+.1)*10)/10);applyZoom()};
document.addEventListener('keydown',event=>{if(!(event.metaKey||event.ctrlKey)||event.key.toLowerCase()!=='z')return;const target=event.target;if(target instanceof HTMLElement&&(target.matches('textarea,input,select')||target.isContentEditable))return;event.preventDefault();queueLayout(()=>simple(event.shiftKey?'/api/redo':'/api/undo'))});window.addEventListener('beforeunload',event=>{if(!dirty)return;event.preventDefault();event.returnValue=''})
function escapeText(value){const div=document.createElement('div');div.textContent=value;return div.innerHTML}load(true);
</script></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}
