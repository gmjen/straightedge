/** Chromium integration: Mermaid measurement, painting, and DOM-derived visual evidence. */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type LaunchOptions } from "puppeteer";
import type { LayoutData } from "./baseline.js";
import type { Canvas } from "./canvas.js";
import type { Layout, NodeStyle, VisualMeasurements } from "./types.js";

// Resolve through Node's package resolver so both a source checkout and a
// consumer install with hoisted dependencies find Mermaid correctly.
const MERMAID_SCRIPT = fileURLToPath(import.meta.resolve("mermaid/dist/mermaid.min.js"));
const MAC_BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

export interface PaintResult {
  svg: string;
  png: Buffer;
  visual: VisualMeasurements;
}

export interface BrowserDoctorResult {
  ok: boolean;
  executable: string;
  version?: string;
  message: string;
}

export async function withBrowserSession<T>(run: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await openBrowser();
  try {
    return await run(browser);
  } finally {
    await browser.close();
  }
}

export async function openBrowser(): Promise<Browser> {
  try {
    return await puppeteer.launch(browserLaunchOptions());
  } catch (error) {
    throw new Error(browserError(error));
  }
}

export function browserLaunchOptions(): LaunchOptions {
  const executablePath = browserExecutable();
  const disableSandbox = process.env.STRAIGHTEDGE_CHROMIUM_NO_SANDBOX === "1";
  return {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    ...(disableSandbox ? { args: ["--no-sandbox", "--disable-setuid-sandbox"] } : {}),
  };
}

export async function parseMermaid(source: string, browser?: Browser): Promise<LayoutData> {
  return useBrowser(browser, async (active) => {
    const page = await active.newPage();
    try {
      await page.setContent("<!doctype html><html><body></body></html>");
      await page.addScriptTag({ path: MERMAID_SCRIPT });
      return (await page.evaluate(async (mermaidSource) => {
        const mermaid = (globalThis as any).mermaid;
        let captured: any;
        mermaid.registerLayoutLoaders([{
          name: "straightedge_capture",
          loader: async () => ({
            render: async (data: any, svg: any, helpers: any) => {
              const nodes = svg.select("g").append("g").attr("class", "nodes");
              await Promise.all(data.nodes.map((node: any) =>
                helpers.insertNode(nodes, node, { config: data.config, dir: data.direction })));
              captured = {
                type: data.type,
                direction: data.direction,
                nodes: data.nodes.map((node: any) => ({
                  id: node.id,
                  label: node.label,
                  shape: node.shape,
                  width: node.width,
                  height: node.height,
                  isGroup: node.isGroup,
                  parentId: node.parentId,
                })),
                edges: data.edges.map((edge: any) => ({
                  id: edge.id,
                  start: edge.start,
                  end: edge.end,
                  label: edge.label,
                })),
              };
            },
          }),
        }]);
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          deterministicIds: true,
          deterministicIDSeed: "straightedge",
          layout: "straightedge_capture",
          flowchart: { htmlLabels: false },
        });
        await mermaid.render("straightedge-capture", mermaidSource);
        if (!captured) throw new Error("Mermaid did not invoke the Straightedge layout loader");
        return captured;
      }, source)) as LayoutData;
    } finally {
      await page.close();
    }
  });
}

export async function paint(
  source: string,
  layout: Layout,
  canvas: Canvas,
  browser?: Browser,
): Promise<PaintResult> {
  return useBrowser(browser, async (active) => {
    const page = await active.newPage();
    try {
      await page.setViewport({
        width: Math.max(1, Math.ceil(canvas.width)),
        height: Math.max(1, Math.ceil(canvas.height)),
        deviceScaleFactor: canvas.rasterScale ?? 1,
      });
      await page.setContent("<!doctype html><html><body style='margin:0;overflow:hidden'><div id='diagram'></div></body></html>");
      await page.addScriptTag({ path: MERMAID_SCRIPT });

      const evaluated = await page.evaluate(
        async ({ mermaidSource, finalLayout, finalCanvas }) => {
          const mermaid = (globalThis as any).mermaid;
          (globalThis as any).__straightedgeLayout = finalLayout;
          mermaid.registerLayoutLoaders([{
            name: "straightedge_paint",
            loader: async () => ({
              render: async (data: any, svgRoot: any, helpers: any) => {
                const resolved = (globalThis as any).__straightedgeLayout;
                const root = svgRoot.select("g");
                helpers.insertMarkers(root, data.markers, data.type, data.diagramId);
                const edgePaths = root.append("g").attr("class", "edgePaths");
                const edgeLabels = root.append("g").attr("class", "edgeLabels");
                const nodes = root.append("g").attr("class", "nodes");

                await Promise.all(data.nodes.map(async (node: any) => {
                  const placed = resolved.nodes[node.id];
                  if (!placed) throw new Error(`No resolved geometry for node "${node.id}"`);
                  node.width = placed.width;
                  node.height = placed.height;
                  const element = await helpers.insertNode(nodes, node, { config: data.config, dir: data.direction });
                  element.attr("data-straightedge-node", node.id);
                  fitShape(element, placed);
                  element.attr("transform", `translate(${placed.x + placed.width / 2}, ${placed.y + placed.height / 2})`);
                  node.x = placed.x + placed.width / 2;
                  node.y = placed.y + placed.height / 2;
                  node.width = placed.width;
                  node.height = placed.height;
                  applyStyle(element, placed.style);
                }));

                await Promise.all(data.edges.map(async (edge: any) => {
                  if (hasLabel(edge)) {
                    const element = await helpers.insertEdgeLabel(edgeLabels, edge);
                    if (element?.attr) element.attr("data-straightedge-edge-label", edge.id);
                  }
                }));

                for (const edge of data.edges) {
                  const placed = resolved.edges.find((candidate: any) => candidate.id === edge.id);
                  if (!placed) throw new Error(`No resolved geometry for edge "${edge.id}"`);
                  const start = data.nodes.find((node: any) => node.id === edge.start);
                  const end = data.nodes.find((node: any) => node.id === edge.end);
                  edge.points = placed.points;
                  const middle = placed.points[Math.floor(placed.points.length / 2)] ?? edge.points[0];
                  edge.x = middle.x;
                  edge.y = middle.y;
                  const paths = helpers.insertEdge(
                    edgePaths,
                    edge,
                    new Map(),
                    data.type,
                    { ...start, intersect: undefined },
                    { ...end, intersect: undefined },
                    data.diagramId,
                  );
                  paths?.attr?.("data-straightedge-edge", edge.id);
                  if (hasLabel(edge)) helpers.positionEdgeLabel(edge, paths);
                }

                function hasLabel(edge: any) {
                  return edge.label || edge.startLabelLeft || edge.startLabelRight || edge.endLabelLeft || edge.endLabelRight;
                }
                function applyStyle(element: any, style: any) {
                  if (!style) return;
                  const shapes = element.selectAll(".label-container");
                  if (style.fill !== undefined) shapes.attr("fill", style.fill).style("fill", style.fill);
                  if (style.stroke !== undefined) shapes.attr("stroke", style.stroke).style("stroke", style.stroke);
                  if (style.strokeWidth !== undefined) shapes.attr("stroke-width", style.strokeWidth).style("stroke-width", `${style.strokeWidth}px`);
                  if (style.radius !== undefined) shapes.attr("rx", style.radius).attr("ry", style.radius);
                  const labels = element.selectAll(".label text, .label tspan, .label span, .label p");
                  if (style.textColor !== undefined) labels.style("fill", style.textColor).style("color", style.textColor);
                  if (style.fontWeight !== undefined) labels.style("font-weight", style.fontWeight);
                  if (style.fontFamily !== undefined) labels.style("font-family", style.fontFamily);
                  if (style.fontSize !== undefined) labels.style("font-size", `${style.fontSize}px`);
                }
                function fitShape(element: any, placed: any) {
                  const shape = element.select(".label-container");
                  const shapeNode = shape.node();
                  if (!shapeNode) return;
                  const box = shapeNode.getBBox();
                  if (!box.width || !box.height) return;
                  const sx = placed.width / box.width;
                  const sy = placed.height / box.height;
                  if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return;
                  const cx = box.x + box.width / 2;
                  const cy = box.y + box.height / 2;
                  const existing = shape.attr("transform") ?? "";
                  shape.attr("transform", `translate(${cx}, ${cy}) scale(${sx}, ${sy}) translate(${-cx}, ${-cy}) ${existing}`);
                }
              },
            }),
          }]);
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            suppressErrorRendering: true,
            deterministicIds: true,
            deterministicIDSeed: "straightedge",
            layout: "straightedge_paint",
            flowchart: { htmlLabels: false },
          });
          const rendered = await mermaid.render("straightedge-diagram", mermaidSource);
          const host = (globalThis as any).document.querySelector("#diagram")!;
          host.innerHTML = rendered.svg;
          const element = host.querySelector("svg")!;
          const vbWidth = finalCanvas.viewBoxWidth ?? finalCanvas.width;
          const vbHeight = finalCanvas.viewBoxHeight ?? finalCanvas.height;
          const vbX = finalCanvas.viewBoxX ?? 0;
          const vbY = finalCanvas.viewBoxY ?? 0;
          element.setAttribute("viewBox", `${vbX} ${vbY} ${vbWidth} ${vbHeight}`);
          element.setAttribute("width", String(finalCanvas.width));
          element.setAttribute("height", String(finalCanvas.height));
          element.setAttribute("preserveAspectRatio", "xMidYMid meet");
          element.removeAttribute("style");
          const background = finalCanvas.transparent ? "transparent" : (finalCanvas.background ?? "white");
          element.setAttribute("style", `background: ${background}; max-width: none;`);

          await new Promise<void>((resolve) => (globalThis as any).requestAnimationFrame(() =>
            (globalThis as any).requestAnimationFrame(() => resolve())));

          const rect = (candidate: any) => {
            const box = candidate.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height };
          };
          const contentRect = (candidate: any) => {
            const box = rect(candidate);
            const range = (globalThis as any).document.createRange();
            range.selectNodeContents(candidate);
            const rangeBox = range.getBoundingClientRect();
            const width = Math.max(box.width, rangeBox.width, candidate.scrollWidth ?? 0);
            const height = Math.max(box.height, rangeBox.height, candidate.scrollHeight ?? 0);
            return {
              x: box.x - (width - box.width) / 2,
              y: box.y - (height - box.height) / 2,
              width,
              height,
            };
          };
          const visualNodes = [...host.querySelectorAll("[data-straightedge-node]")].map((node: any) => {
            const id = node.getAttribute("data-straightedge-node");
            const shape = node.querySelector(".label-container");
            const label = node.querySelector(".label p, .label text, .label span") ?? node.querySelector(".label");
            return {
              id,
              shape: finalLayout.nodes[id]?.shape ?? "rect",
              shapeBounds: rect(shape),
              labelBounds: contentRect(label),
            };
          });
          const visualEdgeLabels = [...host.querySelectorAll("[data-straightedge-edge-label]")].map((label: any) => ({
            edge: label.getAttribute("data-straightedge-edge-label"),
            bounds: rect(label),
          }));
          return {
            svg: element.outerHTML,
            visual: { nodes: visualNodes, edgeLabels: visualEdgeLabels },
          };
        },
        { mermaidSource: source, finalLayout: layout, finalCanvas: canvas },
      ) as { svg: string; visual: VisualMeasurements };

      const element = await page.$("#diagram svg");
      if (!element) throw new Error("Mermaid did not produce an SVG");
      const png = Buffer.from(await element.screenshot({ type: "png", omitBackground: canvas.transparent ?? false }));
      return { svg: evaluated.svg, visual: evaluated.visual, png };
    } finally {
      await page.close();
    }
  });
}

export async function paintSvg(source: string, layout: Layout, canvas: Canvas): Promise<string> {
  return (await paint(source, layout, canvas)).svg;
}

export async function svgToPng(svg: string, canvas: Canvas): Promise<Buffer> {
  return useBrowser(undefined, async (browser) => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: Math.max(1, Math.ceil(canvas.width)), height: Math.max(1, Math.ceil(canvas.height)) });
      await page.setContent(`<body style="margin:0">${svg}</body>`);
      const element = await page.$("svg");
      if (!element) throw new Error("SVG document has no svg element");
      return Buffer.from(await element.screenshot({ type: "png" }));
    } finally {
      await page.close();
    }
  });
}

export async function doctorBrowser(): Promise<BrowserDoctorResult> {
  const executable = browserExecutable() ?? "Puppeteer bundled Chromium";
  try {
    return await withBrowserSession(async (browser) => {
      const page = await browser.newPage();
      await page.setContent("<!doctype html><title>Straightedge doctor</title><p>ok</p>");
      await page.close();
      return { ok: true, executable, version: await browser.version(), message: "Chromium launch and smoke page succeeded" };
    });
  } catch (error) {
    return {
      ok: false,
      executable,
      message: browserError(error),
    };
  }
}

export function styleToAttributes(style: NodeStyle | undefined): Record<string, string> {
  if (!style) return {};
  const attributes: Record<string, string> = {};
  if (style.fill !== undefined) attributes.fill = style.fill;
  if (style.stroke !== undefined) attributes.stroke = style.stroke;
  if (style.strokeWidth !== undefined) attributes["stroke-width"] = String(style.strokeWidth);
  if (style.radius !== undefined) attributes.rx = attributes.ry = String(style.radius);
  if (style.textColor !== undefined) attributes.color = style.textColor;
  if (style.fontWeight !== undefined) attributes["font-weight"] = String(style.fontWeight);
  if (style.fontFamily !== undefined) attributes["font-family"] = style.fontFamily;
  if (style.fontSize !== undefined) attributes["font-size"] = String(style.fontSize);
  return attributes;
}

async function useBrowser<T>(browser: Browser | undefined, run: (active: Browser) => Promise<T>): Promise<T> {
  return browser ? run(browser) : withBrowserSession(run);
}

function browserExecutable(): string | undefined {
  return process.platform === "darwin" ? MAC_BROWSERS.find(existsSync) : undefined;
}

function browserError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const checked = process.platform === "darwin" ? ` Checked ${MAC_BROWSERS.join(", ")}.` : "";
  return `Unable to launch Chromium. Run \"straightedge doctor\" for a smoke test.${checked} ${detail}`;
}
