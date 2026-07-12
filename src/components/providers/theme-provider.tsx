"use client";

import { Theme } from "@astryxdesign/core";
import type { ReactNode } from "react";
import type { ThemeMode } from "@/domain/settings";
import { precisionTheme } from "@/themes/precision.js";

interface ThemeProviderProps {
  children: ReactNode;
  /** Defaults to "system". DashboardApp feeds the persisted `settings.theme` here; the command palette's theme commands change it. */
  mode?: ThemeMode;
}

export function ThemeProvider({ children, mode = "system" }: ThemeProviderProps) {
  return (
    <Theme theme={precisionTheme} mode={mode}>
      {children}
    </Theme>
  );
}
