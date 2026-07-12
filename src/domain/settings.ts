import { z } from "zod";
import { AgentStatusKindSchema } from "./agent/status";

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
  "actions",
  "progress",
  "recentActivity",
  "runningTime",
  "cost",
] as const;

export const OPTIONAL_HIDDEN_COLUMNS = ["model", "tokens", "retryCount", "heartbeat", "runtimeId"] as const;

const sortStateSchema = z.object({ id: z.string().min(1).max(64), desc: z.boolean() });

const dashboardSettingsSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  theme: ThemeModeSchema,
  sidebarCollapsed: z.boolean(),
  rowDensity: RowDensitySchema,
  visibleColumns: z.array(z.string()),
  columnWidths: z.record(z.string(), z.number().min(40).max(2_000)),
  statusFilter: z.array(AgentStatusKindSchema).max(AgentStatusKindSchema.options.length),
  projectFilter: z.array(z.string().min(1).max(4_096)).max(100),
  branchFilter: z.array(z.string().min(1).max(1_024)).max(100),
  sort: z.array(sortStateSchema).max(DEFAULT_VISIBLE_COLUMNS.length + OPTIONAL_HIDDEN_COLUMNS.length),
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
  return structuredClone(DEFAULT_DASHBOARD_SETTINGS);
}
