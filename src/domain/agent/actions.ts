import { z } from "zod";
import { AgentIdSchema } from "./agent";

/**
 * Honest action set: the monitor discovers externally-launched Codex processes via
 * `ps`/`lsof` — it does not own their stdin/PTY. "retry", "approve", "reject" are kept
 * as valid actions in the type system (the UI can render them) but the local adapter
 * always returns status "skipped" with an explanatory message for those three; there is
 * no code path that fakes success. See data-access/local-adapter.ts for the real/no-op split.
 */
export const AgentActionTypeSchema = z.enum([
  "pause",
  "resume",
  "stop",
  "retry",
  "approve",
  "reject",
  "open_terminal",
  "view_diff",
  "create_pr",
  "open_pr",
]);
export type AgentActionType = z.infer<typeof AgentActionTypeSchema>;

export const AgentActionRequestSchema = z.object({
  action: AgentActionTypeSchema,
  /** Escalation flag: stop -> SIGKILL after SIGTERM was already tried. */
  force: z.boolean().optional(),
});
export type AgentActionRequest = z.infer<typeof AgentActionRequestSchema>;

export const AgentActionResultSchema = z.object({
  agentId: AgentIdSchema,
  action: AgentActionTypeSchema,
  status: z.enum(["success", "failed", "skipped"]),
  message: z.string(),
});
export type AgentActionResult = z.infer<typeof AgentActionResultSchema>;

export const BulkAgentActionRequestSchema = z.object({
  agentIds: z
    .array(AgentIdSchema)
    .min(1)
    .max(100)
    .refine((agentIds) => new Set(agentIds).size === agentIds.length, { message: "Agent IDs must be unique." }),
  action: AgentActionTypeSchema,
  force: z.boolean().optional(),
});
export type BulkAgentActionRequest = z.infer<typeof BulkAgentActionRequestSchema>;

export const BulkAgentActionResponseSchema = z.object({
  results: z.array(AgentActionResultSchema),
});
export type BulkAgentActionResponse = z.infer<typeof BulkAgentActionResponseSchema>;
