import { z } from "zod";

export const IncidentSeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type IncidentSeverity = z.infer<typeof IncidentSeveritySchema>;

/**
 * Full catalog per spec. Only "stale_heartbeat" and "realtime_disconnected" have a real
 * signal in the current Codex state DB / rollout logs (verified by inspecting the live
 * schema and event vocabulary — see the migration report). The rest are wired into the
 * detector framework but return no incidents from the local adapter until a real signal
 * exists (repeated_failure/log_error_spike need Codex to emit an error event type it
 * currently doesn't; cost_spike needs a pricing table; concurrent_file_edit/branch_conflict
 * need git worktree inspection not yet implemented).
 */
export const IncidentTypeSchema = z.enum([
  "stale_heartbeat",
  "repeated_failure",
  "abnormally_long_run",
  "cost_spike",
  "concurrent_file_edit",
  "branch_conflict",
  "approval_pending_too_long",
  "dependency_blocked",
  "log_error_spike",
  "realtime_disconnected",
]);
export type IncidentType = z.infer<typeof IncidentTypeSchema>;

export const IncidentSchema = z.object({
  id: z.string(),
  severity: IncidentSeveritySchema,
  type: IncidentTypeSchema,
  detectedAt: z.iso.datetime(),
  affectedAgentIds: z.array(z.string()),
  affectedProjectIds: z.array(z.string()),
  summary: z.string(),
  /** Concrete observed values (e.g. "no heartbeat for 42m"), not an inferred verdict. */
  evidence: z.string(),
  suggestedAction: z.string(),
});
export type Incident = z.infer<typeof IncidentSchema>;
