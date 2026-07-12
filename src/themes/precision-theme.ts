import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

export const precisionTheme = defineTheme({
  name: "precision",
  extends: neutralTheme,
  color: {
    accent: "#0064E0",
    neutralStyle: "cool",
    contrast: "standard",
  },
  typography: {
    body: {
      family: "var(--font-instrument-sans)",
      fallbacks: '"Avenir Next", "Helvetica Neue", sans-serif',
    },
    heading: {
      family: "var(--font-instrument-sans)",
      fallbacks: '"Avenir Next", "Helvetica Neue", sans-serif',
    },
    code: {
      family: "var(--font-ibm-plex-mono)",
      fallbacks: '"SFMono-Regular", Consolas, monospace',
    },
  },
  tokens: {
    "--color-accent": ["#0064E0", "#2694FE"],
    "--color-accent-muted": ["#0082FB33", "#0082FB3F"],
    "--color-on-accent": "#FFFFFF",
    "--color-text-accent": ["#0064E0", "#3E9EFB"],
    "--color-icon-accent": ["#0064E0", "#2694FE"],
    "--color-background-body": ["#F1F4F7", "#111112"],
    "--color-background-surface": ["#FFFFFF", "#1F1F22"],
    "--color-background-card": ["#FFFFFF", "#1F1F22"],
    "--color-background-popover": ["#FFFFFF", "#28292C"],
    "--color-background-muted": ["#0536590C", "#1111127F"],
    "--color-overlay-hover": ["#0536590C", "#FFFFFF0C"],
    "--color-overlay-pressed": ["#05365919", "#FFFFFF19"],
    "--color-text-primary": ["#0A1317", "#DFE2E5"],
    "--color-text-secondary": ["#4E606F", "#AAAFB5"],
    "--color-text-disabled": ["#A4B0BC", "#6F747C"],
    "--color-text-yellow": ["#584400", "#FFE7A8"],
    "--color-border": ["#05365919", "#F2F4F619"],
    "--color-border-emphasized": ["#CCD3DB", "#494D53"],
    "--color-track": ["#CCD3DB", "#5A5E66"],
  },
});
