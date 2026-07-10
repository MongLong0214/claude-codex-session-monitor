import { z } from "zod";

export const ThemeModeSchema = z.enum(["light", "dark", "system"]);
export type ThemeMode = z.infer<typeof ThemeModeSchema>;

export const RowDensitySchema = z.enum(["compact", "comfortable"]);
export type RowDensity = z.infer<typeof RowDensitySchema>;

export const DEFAULT_VISIBLE_COLUMNS = [
  "select",
  "status",
  "agent",
  "projectBranch",
  "currentTask",
  "progress",
  "recentActivity",
  "runningTime",
  "cost",
  "actions",
] as const;

export const OPTIONAL_HIDDEN_COLUMNS = ["model", "tokens", "retryCount", "heartbeat", "runtimeId"] as const;

const sortStateSchema = z.object({ id: z.string(), desc: z.boolean() });

const dashboardSettingsSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  theme: ThemeModeSchema,
  sidebarCollapsed: z.boolean(),
  rowDensity: RowDensitySchema,
  visibleColumns: z.array(z.string()),
  columnWidths: z.record(z.string(), z.number()),
  statusFilter: z.array(z.string()),
  projectFilter: z.array(z.string()),
  branchFilter: z.array(z.string()),
  sort: z.array(sortStateSchema),
});
export type DashboardSettings = z.infer<typeof dashboardSettingsSchemaV1>;

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  schemaVersion: 1,
  theme: "system",
  sidebarCollapsed: false,
  rowDensity: "compact",
  visibleColumns: [...DEFAULT_VISIBLE_COLUMNS],
  columnWidths: {},
  statusFilter: [],
  projectFilter: [],
  branchFilter: [],
  sort: [],
};

export const DASHBOARD_SETTINGS_STORAGE_KEY = "codex-session-monitor:dashboard-settings";

/**
 * Validates persisted settings and falls back to defaults on any mismatch — a corrupted
 * or pre-migration localStorage value never breaks the dashboard. schemaVersion is the
 * only migration hook needed today (v1 is the first shape); bump + branch here when v2 lands.
 */
export function parseDashboardSettings(raw: unknown): DashboardSettings {
  const result = dashboardSettingsSchemaV1.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  return DEFAULT_DASHBOARD_SETTINGS;
}
