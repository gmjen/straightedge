import type { Canvas } from "./canvas.js";
import type { FrameStatus, Presentation, PresentationPreset } from "./types.js";

export const PRESETS: Record<PresentationPreset, Required<Pick<Presentation, "width" | "height" | "padding" | "minFontSize">>> = {
  "slides-16:9": { width: 1600, height: 900, padding: 64, minFontSize: 14 },
  "slides-4:3": { width: 1200, height: 900, padding: 56, minFontSize: 14 },
  "a4-portrait": { width: 794, height: 1123, padding: 48, minFontSize: 11 },
  "readme-wide": { width: 1200, height: 630, padding: 40, minFontSize: 13 },
};

export interface AppliedPresentation {
  canvas: Canvas;
  frame: FrameStatus;
}

export function minimumFontSize(input: Presentation): number {
  return input.minFontSize ?? (input.preset ? PRESETS[input.preset].minFontSize : 12);
}

export function applyPresentation(
  natural: Canvas,
  input: Presentation,
  themeBackground?: string,
  baseFontSize = 16,
): AppliedPresentation {
  const preset = input.preset ? PRESETS[input.preset] : undefined;
  const width = input.width ?? preset?.width;
  const height = input.height ?? preset?.height;
  const padding = input.padding ?? preset?.padding ?? 32;
  const minFontSize = input.minFontSize ?? preset?.minFontSize ?? 12;
  const background = input.background ?? themeBackground ?? "#ffffff";
  const transparent = input.transparent ?? false;
  const rasterScale = input.rasterScale ?? 1;

  if (width === undefined || height === undefined) {
    return {
      canvas: {
        ...natural,
        background,
        transparent,
        rasterScale,
      },
      frame: {
        active: false,
        satisfied: true,
        width: natural.width,
        height: natural.height,
        contentScale: 1,
        effectiveFontSize: baseFontSize,
      },
    };
  }

  assertPositive("presentation width", width);
  assertPositive("presentation height", height);
  assertPositive("presentation padding", padding, true);
  assertPositive("presentation raster scale", rasterScale);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const contentScale = Math.min(availableWidth / natural.width, availableHeight / natural.height);
  const effectiveFontSize = baseFontSize * contentScale;

  // Expanding the viewBox creates deterministic target padding and aspect ratio while SVG scales
  // all geometry and typography together.
  const viewBoxWidth = width / contentScale;
  const viewBoxHeight = height / contentScale;

  return {
    canvas: {
      width,
      height,
      viewBoxWidth,
      viewBoxHeight,
      viewBoxX: -(viewBoxWidth - natural.width) / 2,
      viewBoxY: -(viewBoxHeight - natural.height) / 2,
      background,
      transparent,
      rasterScale,
    },
    frame: {
      active: true,
      satisfied: effectiveFontSize >= minFontSize,
      width,
      height,
      contentScale,
      effectiveFontSize,
    },
  };
}

function assertPositive(name: string, value: number, allowZero = false): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${name} must be ${allowZero ? "non-negative" : "positive"}`);
  }
}
