import type { Layout, NodeStyle, ThemeName, ThemeRole } from "./types.js";

interface Theme {
  background: string;
  node: NodeStyle;
  roles: Partial<Record<ThemeRole, NodeStyle>>;
}

export const THEMES: Record<ThemeName, Theme> = {
  "executive-light": {
    background: "#ffffff",
    node: {
      fill: "#f8fafc",
      stroke: "#334155",
      strokeWidth: 1.5,
      textColor: "#0f172a",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      fontSize: 16,
      fontWeight: 500,
    },
    roles: {
      primary: { fill: "#e0f2fe", stroke: "#0369a1", fontWeight: 650 },
      secondary: { fill: "#f1f5f9", stroke: "#64748b" },
      critical: { fill: "#fee2e2", stroke: "#b91c1c", textColor: "#7f1d1d", fontWeight: 650 },
      muted: { fill: "#f8fafc", stroke: "#94a3b8", textColor: "#64748b" },
    },
  },
  technical: {
    background: "#ffffff",
    node: {
      fill: "#eff6ff",
      stroke: "#1d4ed8",
      strokeWidth: 1.5,
      textColor: "#172554",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 15,
      fontWeight: 500,
    },
    roles: {
      primary: { fill: "#dbeafe", stroke: "#1e40af", fontWeight: 700 },
      secondary: { fill: "#ecfeff", stroke: "#0e7490" },
      critical: { fill: "#fff1f2", stroke: "#be123c", textColor: "#881337" },
      muted: { fill: "#f8fafc", stroke: "#94a3b8", textColor: "#64748b" },
    },
  },
  monochrome: {
    background: "#ffffff",
    node: {
      fill: "#ffffff",
      stroke: "#111827",
      strokeWidth: 1.5,
      textColor: "#111827",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontSize: 16,
      fontWeight: 500,
    },
    roles: {
      primary: { fill: "#e5e7eb", strokeWidth: 2, fontWeight: 700 },
      secondary: { fill: "#f3f4f6" },
      critical: { fill: "#d1d5db", strokeWidth: 2.5, fontWeight: 700 },
      muted: { fill: "#ffffff", stroke: "#9ca3af", textColor: "#6b7280" },
    },
  },
};

export function applyTheme(layout: Layout, name: ThemeName | undefined): Layout {
  if (!name) return layout;
  const theme = THEMES[name];
  return {
    ...layout,
    nodes: Object.fromEntries(
      Object.values(layout.nodes).map((node) => {
        const explicit = node.style ?? {};
        const role = explicit.role ?? "default";
        const roleStyle = theme.roles[role] ?? {};
        return [node.id, { ...node, style: { ...theme.node, ...roleStyle, ...explicit } }];
      }),
    ),
  };
}

export function themeBackground(name: ThemeName | undefined): string | undefined {
  return name ? THEMES[name].background : undefined;
}
