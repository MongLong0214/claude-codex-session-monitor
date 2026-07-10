import { z } from "zod";
import { AgentSchema, ProjectRefSchema } from "./agent/agent";
import { AgentStatusKindSchema } from "./agent/status";
import { IncidentSchema } from "./incident/incident";

export const DashboardSummarySchema = z.object({
  totalAgents: z.number().int().nonnegative(),
  activeProjects: z.number().int().nonnegative(),
  /** Always carries all nine keys (0 when empty) so top-bar counters never have to guess a default. */
  statusCounts: z.record(AgentStatusKindSchema, z.number().int().nonnegative()),
  /** Null when no pricing table is configured for the observed models. */
  sessionCostUsd: z.number().nonnegative().nullable(),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

/**
 * Normalized shape: table/detail-panel subscribe to slices of this (allIds+summary, or a
 * single agent by id), never the full byId map, so unrelated rows keep their object
 * reference when one agent updates.
 */
export const DashboardSnapshotSchema = z.object({
  byId: z.record(z.string(), AgentSchema),
  allIds: z.array(z.string()),
  projects: z.array(ProjectRefSchema),
  incidents: z.array(IncidentSchema),
  summary: DashboardSummarySchema,
  revision: z.number().int().nonnegative(),
  lastSyncedAt: z.iso.datetime(),
  warnings: z.array(z.string()),
});
export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>;
