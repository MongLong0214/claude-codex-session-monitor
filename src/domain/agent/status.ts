import { z } from "zod";

/**
 * The local Codex state DB only ever yields evidence for a subset of these kinds
 * (see data-access/local-adapter.ts). The others exist so the UI, table sort, and
 * filters are built for the full vocabulary — the mock adapter exercises all nine.
 */
const RunningStatusSchema = z.object({
  kind: z.literal("running"),
  startedAt: z.iso.datetime(),
  lastHeartbeatAt: z.iso.datetime(),
});

const WaitingStatusSchema = z.object({
  kind: z.literal("waiting"),
  since: z.iso.datetime(),
});

const ApprovalRequiredStatusSchema = z.object({
  kind: z.literal("approval_required"),
  requestedAt: z.iso.datetime(),
  reason: z.string().optional(),
});

const BlockedStatusSchema = z.object({
  kind: z.literal("blocked"),
  blocker: z.string(),
  since: z.iso.datetime(),
});

const FailedStatusSchema = z.object({
  kind: z.literal("failed"),
  error: z.string(),
  retryCount: z.number().int().nonnegative(),
  failedAt: z.iso.datetime(),
});

const CompletedStatusSchema = z.object({
  kind: z.literal("completed"),
  completedAt: z.iso.datetime(),
});

const PausedStatusSchema = z.object({
  kind: z.literal("paused"),
  pausedAt: z.iso.datetime(),
});

const StaleStatusSchema = z.object({
  kind: z.literal("stale"),
  lastHeartbeatAt: z.iso.datetime(),
});

const OfflineStatusSchema = z.object({
  kind: z.literal("offline"),
  lastSeenAt: z.iso.datetime().nullable(),
});

export const AgentStatusSchema = z.discriminatedUnion("kind", [
  RunningStatusSchema,
  WaitingStatusSchema,
  ApprovalRequiredStatusSchema,
  BlockedStatusSchema,
  FailedStatusSchema,
  CompletedStatusSchema,
  PausedStatusSchema,
  StaleStatusSchema,
  OfflineStatusSchema,
]);

export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentStatusKindSchema = z.enum([
  "running",
  "waiting",
  "approval_required",
  "blocked",
  "failed",
  "completed",
  "paused",
  "stale",
  "offline",
]);
export type AgentStatusKind = z.infer<typeof AgentStatusKindSchema>;

/** Table default sort priority (critical-first), per spec section on sort order. */
export const STATUS_SORT_PRIORITY: Record<AgentStatusKind, number> = {
  failed: 0,
  blocked: 1,
  stale: 2,
  offline: 3,
  approval_required: 4,
  running: 5,
  waiting: 6,
  paused: 7,
  completed: 8,
};
