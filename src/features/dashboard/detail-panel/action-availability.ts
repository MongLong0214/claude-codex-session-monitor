import type { AgentActionType } from "@/domain/agent/actions";
import type { Agent } from "@/domain/agent/agent";

/**
 * Why an action cannot run right now. These mirror the local adapter's own refusal paths
 * (data-access/local-adapter.ts) so a disabled button never contradicts what the server would answer.
 */
export const NO_CONTROL_CHANNEL_REASON =
  "This monitor is a read-only observer. Sessions started externally have no stdin/PTY control channel, so this action cannot be sent.";
const NO_RUNTIME_REASON = "No running Codex process was found in the working directory.";
const NO_WORKING_DIRECTORY_REASON = "The agent's working directory is unavailable.";

/** ACTION_HANDLERS answers these with status "skipped" unconditionally — never "sometimes available". */
const NO_CONTROL_CHANNEL_ACTIONS = new Set<AgentActionType>(["retry", "approve", "reject"]);

/** signalAgentProcesses() short-circuits when the agent has no observed pids. */
const PROCESS_SIGNAL_ACTIONS = new Set<AgentActionType>(["stop", "pause", "resume"]);

export interface ActionAvailability {
  isDisabled: boolean;
  /** Surfaced as the button's tooltip; Button switches to aria-disabled so it stays focusable. */
  reason: string | null;
}

const AVAILABLE: ActionAvailability = { isDisabled: false, reason: null };

export function resolveActionAvailability(agent: Agent, action: AgentActionType): ActionAvailability {
  if (NO_CONTROL_CHANNEL_ACTIONS.has(action)) {
    return { isDisabled: true, reason: NO_CONTROL_CHANNEL_REASON };
  }

  if (PROCESS_SIGNAL_ACTIONS.has(action)) {
    return agent.runtimePids.length > 0 ? AVAILABLE : { isDisabled: true, reason: NO_RUNTIME_REASON };
  }

  return agent.project.cwd ? AVAILABLE : { isDisabled: true, reason: NO_WORKING_DIRECTORY_REASON };
}
