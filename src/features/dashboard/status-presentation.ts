import type { AgentStatusKind } from "@/domain/agent/status";
import type { ConnectionStatus } from "@/lib/realtime/transport";

/**
 * StatusDot only ships 5 semantic variants, so several of our 9 states share a color —
 * they're always paired with STATUS_LABEL text too, never color-only (see StatusDot's own
 * accessibility guidance).
 */
export const STATUS_DOT_VARIANT: Record<AgentStatusKind, "success" | "warning" | "error" | "accent" | "neutral"> = {
  running: "success",
  waiting: "warning",
  approval_required: "warning",
  blocked: "warning",
  failed: "error",
  completed: "neutral",
  paused: "neutral",
  stale: "warning",
  offline: "neutral",
};

export const STATUS_LABEL: Record<AgentStatusKind, string> = {
  running: "Running",
  waiting: "Waiting",
  approval_required: "Approval required",
  blocked: "Blocked",
  failed: "Failed",
  completed: "Completed",
  paused: "Paused",
  stale: "Stale",
  offline: "Offline",
};

export const CONNECTION_DOT_VARIANT: Record<ConnectionStatus, "success" | "warning" | "error" | "accent" | "neutral"> =
  {
    connecting: "neutral",
    open: "success",
    reconnecting: "warning",
    stale: "warning",
    closed: "neutral",
  };

export const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting",
  open: "Live",
  reconnecting: "Reconnecting",
  stale: "Delayed",
  closed: "Disconnected",
};
