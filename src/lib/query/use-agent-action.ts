import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AgentActionRequest,
  AgentActionResult,
  BulkAgentActionRequest,
  BulkAgentActionResponse,
} from "@/domain/agent/actions";
import type { Agent, AgentId } from "@/domain/agent/agent";
import type { AgentStatus } from "@/domain/agent/status";
import type { DashboardSnapshot } from "@/domain/dashboard";
import { postAgentAction, postBulkAgentAction } from "./api";
import { dashboardKeys } from "./keys";

const optimisticCountStates = new WeakSet<DashboardSnapshot["summary"]["statusCounts"]>();
const optimisticAgentIdsByClient = new WeakMap<QueryClient, Set<AgentId>>();

function getOptimisticAgentIds(queryClient: QueryClient): Set<AgentId> {
  const existing = optimisticAgentIdsByClient.get(queryClient);
  if (existing) {
    return existing;
  }
  const created = new Set<AgentId>();
  optimisticAgentIdsByClient.set(queryClient, created);
  return created;
}

export type OptimisticStatus = AgentStatus | ((current: Agent) => AgentStatus);

export interface AgentActionVariables {
  agentId: AgentId;
  request: AgentActionRequest;
  /**
   * Omit to send the action without touching the cache — the call mode `stop` uses, since it is
   * confirmed by a dialog and its outcome is not predictable. Provide it (e.g. for pause/resume)
   * to patch `byId[agentId].status` until the server reconciles.
   */
  optimisticStatus?: OptimisticStatus;
}

interface AgentActionContext {
  readonly previousAgent?: Agent;
  readonly optimisticAgent?: Agent;
  readonly optimisticStatusCounts?: DashboardSnapshot["summary"]["statusCounts"];
}

function resolveStatus(optimisticStatus: OptimisticStatus, current: Agent): AgentStatus {
  return typeof optimisticStatus === "function" ? optimisticStatus(current) : optimisticStatus;
}

function replaceAgent(snapshot: DashboardSnapshot, agent: Agent): DashboardSnapshot {
  const previous = snapshot.byId[agent.id];
  if (!previous) {
    return snapshot;
  }

  const previousKind = previous.status.kind;
  const nextKind = agent.status.kind;
  const summary =
    previousKind === nextKind
      ? snapshot.summary
      : {
          ...snapshot.summary,
          statusCounts: {
            ...snapshot.summary.statusCounts,
            [previousKind]: snapshot.summary.statusCounts[previousKind] - 1,
            [nextKind]: snapshot.summary.statusCounts[nextKind] + 1,
          },
        };

  return {
    ...snapshot,
    byId: { ...snapshot.byId, [agent.id]: agent },
    summary,
    revision: snapshot.revision + 1,
  };
}

/**
 * Generic optimistic-update-with-rollback plumbing; the caller decides per invocation whether an
 * action is safe to predict. No action is special-cased and no confirmation dialog lives here —
 * that is the UI layer's call.
 *
 * The optimistic write replaces exactly one `byId` entry and moves its summary count, preserving
 * every unrelated reference the realtime reducer depends on. A failed request rolls that entry
 * back only while it is still the exact optimistic value; a newer server event wins. `onSettled`
 * always reconciles against the server, so a backend "skipped" result cannot linger as a lie.
 */
export function useAgentAction() {
  const queryClient = useQueryClient();

  return useMutation<AgentActionResult, Error, AgentActionVariables, AgentActionContext>({
    mutationFn: ({ agentId, request }) => postAgentAction(agentId, request),

    onMutate: async ({ agentId, optimisticStatus }) => {
      if (optimisticStatus === undefined) {
        return {};
      }

      // An in-flight snapshot refetch would otherwise land after this write and clobber it.
      await queryClient.cancelQueries({ queryKey: dashboardKeys.snapshot() });

      const optimisticAgentIds = getOptimisticAgentIds(queryClient);
      if (optimisticAgentIds.has(agentId)) {
        return {};
      }
      const previousSnapshot = queryClient.getQueryData<DashboardSnapshot>(dashboardKeys.snapshot());
      const current = previousSnapshot?.byId[agentId];
      if (!previousSnapshot || !current) {
        return {};
      }

      optimisticAgentIds.add(agentId);
      const optimisticSnapshot = queryClient.setQueryData<DashboardSnapshot>(
        dashboardKeys.snapshot(),
        replaceAgent(previousSnapshot, { ...current, status: resolveStatus(optimisticStatus, current) }),
      );
      const optimisticAgent = optimisticSnapshot?.byId[agentId];
      if (!optimisticAgent) {
        optimisticAgentIds.delete(agentId);
        return {};
      }
      optimisticCountStates.add(optimisticSnapshot.summary.statusCounts);

      return {
        previousAgent: current,
        optimisticAgent,
        optimisticStatusCounts: optimisticSnapshot.summary.statusCounts,
      };
    },

    onError: (_error, { agentId }, context) => {
      if (!context?.previousAgent || !context.optimisticAgent || !context.optimisticStatusCounts) {
        return;
      }
      const { optimisticAgent, optimisticStatusCounts, previousAgent } = context;
      let rolledBackOptimisticCounts = false;
      const rolledBackSnapshot = queryClient.setQueryData<DashboardSnapshot>(dashboardKeys.snapshot(), (current) => {
        if (!current || current.byId[agentId] !== optimisticAgent) {
          return current;
        }
        const rolledBack = replaceAgent(current, previousAgent);
        rolledBackOptimisticCounts =
          current.summary.statusCounts === optimisticStatusCounts ||
          optimisticCountStates.has(current.summary.statusCounts);
        return rolledBackOptimisticCounts ? rolledBack : { ...rolledBack, summary: current.summary };
      });
      if (rolledBackOptimisticCounts && rolledBackSnapshot) {
        optimisticCountStates.add(rolledBackSnapshot.summary.statusCounts);
      }
    },

    onSettled: (_data, _error, { agentId }, context) => {
      if (context?.optimisticAgent) {
        getOptimisticAgentIds(queryClient).delete(agentId);
      }
      return queryClient.invalidateQueries({ queryKey: dashboardKeys.snapshot() });
    },
  });
}

/** No optimistic path: a bulk result is per-agent partial success, which cannot be predicted client-side. */
export function useBulkAgentAction() {
  const queryClient = useQueryClient();

  return useMutation<BulkAgentActionResponse, Error, BulkAgentActionRequest>({
    mutationFn: postBulkAgentAction,
    onSettled: () => queryClient.invalidateQueries({ queryKey: dashboardKeys.snapshot() }),
  });
}
