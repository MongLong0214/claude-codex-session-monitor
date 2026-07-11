import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMockSnapshot } from "@/data-access/mock-adapter";
import type { AgentActionResult } from "@/domain/agent/actions";
import type { Agent } from "@/domain/agent/agent";
import type { AgentStatus, AgentStatusKind } from "@/domain/agent/status";
import type { DashboardSnapshot } from "@/domain/dashboard";
import { createQueryClient } from "./query-client";
import { dashboardKeys } from "./keys";

vi.mock("@/lib/query/api", () => ({
  postAgentAction: vi.fn(),
  postBulkAgentAction: vi.fn(),
}));

import { postAgentAction } from "./api";
import { type AgentActionVariables, useAgentAction } from "./use-agent-action";

const BASE = buildMockSnapshot(Date.parse("2026-07-10T12:00:00.000Z"));

function agentWithStatus(kind: AgentStatusKind): Agent {
  const agent = Object.values(BASE.byId).find((candidate) => candidate.status.kind === kind);
  if (!agent) throw new Error(`mock snapshot must contain a ${kind} agent`);
  return agent;
}

function cachedSnapshot(queryClient: ReturnType<typeof createQueryClient>): DashboardSnapshot {
  const snapshot = queryClient.getQueryData<DashboardSnapshot>(dashboardKeys.snapshot());
  if (!snapshot) throw new Error("snapshot missing from query cache");
  return snapshot;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) {
      if (!resolvePromise) throw new Error("deferred resolve missing");
      resolvePromise(value);
    },
    reject(error) {
      if (!rejectPromise) throw new Error("deferred reject missing");
      rejectPromise(error);
    },
  };
}

function renderAction(snapshot: DashboardSnapshot = BASE) {
  const queryClient = createQueryClient();
  queryClient.setQueryData(dashboardKeys.snapshot(), snapshot);
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, ...renderHook(() => useAgentAction(), { wrapper: Wrapper }) };
}

function successfulResult(agent: Agent, action: "pause" | "resume"): AgentActionResult {
  return { agentId: agent.id, action, status: "success", message: "ok" };
}

function pauseVariables(agent: Agent, pausedAt: string): AgentActionVariables {
  return { agentId: agent.id, request: { action: "pause" }, optimisticStatus: { kind: "paused", pausedAt } };
}

beforeEach(() => vi.mocked(postAgentAction).mockReset());

describe("useAgentAction optimistic cache updates", () => {
  it.each([
    {
      action: "pause" as const,
      from: "running" as const,
      to: "paused" as const,
      status: { kind: "paused", pausedAt: "2026-07-10T12:10:00.000Z" } satisfies AgentStatus,
    },
    {
      action: "resume" as const,
      from: "paused" as const,
      to: "running" as const,
      status: {
        kind: "running",
        startedAt: "2026-07-10T11:00:00.000Z",
        lastHeartbeatAt: "2026-07-10T12:10:00.000Z",
      } satisfies AgentStatus,
    },
  ])("moves summary counts for $action while the request is pending", async ({ action, from, status, to }) => {
    const agent = agentWithStatus(from);
    const request = deferred<AgentActionResult>();
    vi.mocked(postAgentAction).mockReturnValueOnce(request.promise);
    const { queryClient, result } = renderAction();
    const before = cachedSnapshot(queryClient);

    const mutation = result.current.mutateAsync({ agentId: agent.id, request: { action }, optimisticStatus: status });
    await waitFor(() => expect(cachedSnapshot(queryClient).byId[agent.id]?.status.kind).toBe(to));

    const optimistic = cachedSnapshot(queryClient);
    expect(optimistic.summary.statusCounts[from]).toBe(before.summary.statusCounts[from] - 1);
    expect(optimistic.summary.statusCounts[to]).toBe(before.summary.statusCounts[to] + 1);
    expect(optimistic.summary.totalAgents).toBe(before.summary.totalAgents);
    expect(optimistic.summary.sessionCostUsd).toBe(before.summary.sessionCostUsd);
    request.resolve(successfulResult(agent, action));
    await act(async () => mutation);
  });

  it("rolls back only the target over a newer unrelated cache update", async () => {
    const target = agentWithStatus("running");
    const unrelated = Object.values(BASE.byId).find((agent) => agent.id !== target.id);
    if (!unrelated) throw new Error("mock snapshot must contain another agent");
    const request = deferred<AgentActionResult>();
    vi.mocked(postAgentAction).mockReturnValueOnce(request.promise);
    const { queryClient, result } = renderAction();
    const mutation = result.current
      .mutateAsync(pauseVariables(target, "2026-07-10T12:11:00.000Z"))
      .catch((error: unknown) => error);
    await waitFor(() => expect(cachedSnapshot(queryClient).byId[target.id]?.status.kind).toBe("paused"));
    const optimistic = cachedSnapshot(queryClient);
    const newerRevision = optimistic.revision + 10;
    queryClient.setQueryData<DashboardSnapshot>(dashboardKeys.snapshot(), {
      ...optimistic,
      byId: {
        ...optimistic.byId,
        [unrelated.id]: { ...unrelated, displayName: "newer unrelated agent" },
      },
      summary: { ...optimistic.summary, sessionCostUsd: 99 },
      warnings: ["newer warning"],
      lastSyncedAt: "2026-07-10T12:12:00.000Z",
      revision: newerRevision,
    });

    request.reject(new Error("pause failed"));
    await act(async () => mutation);

    const rolledBack = cachedSnapshot(queryClient);
    expect(rolledBack.byId[target.id]?.status).toEqual(target.status);
    expect(rolledBack.byId[unrelated.id]?.displayName).toBe("newer unrelated agent");
    expect(rolledBack.summary.statusCounts.running).toBe(BASE.summary.statusCounts.running);
    expect(rolledBack.summary.statusCounts.paused).toBe(BASE.summary.statusCounts.paused);
    expect(rolledBack.summary.sessionCostUsd).toBe(99);
    expect(rolledBack.warnings).toEqual(["newer warning"]);
    expect(rolledBack.lastSyncedAt).toBe("2026-07-10T12:12:00.000Z");
    expect(rolledBack.revision).toBeGreaterThan(newerRevision);
  });

  it("does not roll back a newer authoritative update of the target", async () => {
    const target = agentWithStatus("running");
    const request = deferred<AgentActionResult>();
    vi.mocked(postAgentAction).mockReturnValueOnce(request.promise);
    const { queryClient, result } = renderAction();
    const paused: AgentStatus = { kind: "paused", pausedAt: "2026-07-10T12:13:00.000Z" };
    const mutation = result.current
      .mutateAsync({ agentId: target.id, request: { action: "pause" }, optimisticStatus: paused })
      .catch((error: unknown) => error);
    await waitFor(() => expect(cachedSnapshot(queryClient).byId[target.id]?.status.kind).toBe("paused"));
    const optimistic = cachedSnapshot(queryClient);
    const optimisticTarget = optimistic.byId[target.id];
    if (!optimisticTarget) throw new Error("optimistic target missing");
    const authoritative = queryClient.setQueryData<DashboardSnapshot>(dashboardKeys.snapshot(), {
      ...optimistic,
      byId: {
        ...optimistic.byId,
        [target.id]: {
          ...optimisticTarget,
          status: paused,
          currentTask: "authoritative newer task",
          updatedAt: "2026-07-10T12:14:00.000Z",
        },
      },
      warnings: ["authoritative"],
      revision: optimistic.revision + 10,
    });

    request.reject(new Error("late mutation failure"));
    await act(async () => mutation);

    expect(cachedSnapshot(queryClient)).toBe(authoritative);
  });

  it("keeps a newer authoritative summary while rolling back the optimistic target", async () => {
    const target = agentWithStatus("running");
    const request = deferred<AgentActionResult>();
    vi.mocked(postAgentAction).mockReturnValueOnce(request.promise);
    const { queryClient, result } = renderAction();
    const mutation = result.current
      .mutateAsync(pauseVariables(target, "2026-07-10T12:15:00.000Z"))
      .catch((error: unknown) => error);
    await waitFor(() => expect(cachedSnapshot(queryClient).byId[target.id]?.status.kind).toBe("paused"));
    const optimistic = cachedSnapshot(queryClient);
    const authoritativeSummary = { ...BASE.summary, sessionCostUsd: 123 };
    const authoritative = queryClient.setQueryData<DashboardSnapshot>(dashboardKeys.snapshot(), {
      ...optimistic,
      summary: authoritativeSummary,
      revision: optimistic.revision + 10,
    });
    if (!authoritative) throw new Error("authoritative snapshot missing");

    request.reject(new Error("pause failed after summary refresh"));
    await act(async () => mutation);

    const rolledBack = cachedSnapshot(queryClient);
    expect(rolledBack.byId[target.id]?.status).toEqual(target.status);
    expect(rolledBack.summary).toBe(authoritative.summary);
  });

  it("rolls back one of two concurrent optimistic mutations without erasing the other count delta", async () => {
    const [first, second] = Object.values(BASE.byId).filter((agent) => agent.status.kind === "running");
    if (!first || !second) throw new Error("mock snapshot must contain two running agents");
    const firstRequest = deferred<AgentActionResult>();
    const secondRequest = deferred<AgentActionResult>();
    vi.mocked(postAgentAction).mockReturnValueOnce(firstRequest.promise).mockReturnValueOnce(secondRequest.promise);
    const { queryClient, result } = renderAction();
    const paused: AgentStatus = { kind: "paused", pausedAt: "2026-07-10T12:16:00.000Z" };

    const firstMutation = result.current
      .mutateAsync({ agentId: first.id, request: { action: "pause" }, optimisticStatus: paused })
      .catch((error: unknown) => error);
    await waitFor(() => expect(cachedSnapshot(queryClient).byId[first.id]?.status.kind).toBe("paused"));
    const secondMutation = result.current.mutateAsync({ ...pauseVariables(second, paused.pausedAt) });
    await waitFor(() => expect(cachedSnapshot(queryClient).byId[second.id]?.status.kind).toBe("paused"));

    firstRequest.reject(new Error("first pause failed"));
    await act(async () => firstMutation);

    const afterRollback = cachedSnapshot(queryClient);
    expect(afterRollback.byId[first.id]?.status).toEqual(first.status);
    expect(afterRollback.byId[second.id]?.status.kind).toBe("paused");
    expect(afterRollback.summary.statusCounts.running).toBe(BASE.summary.statusCounts.running - 1);
    expect(afterRollback.summary.statusCounts.paused).toBe(BASE.summary.statusCounts.paused + 1);
    secondRequest.resolve(successfulResult(second, "pause"));
    await act(async () => secondMutation);
  });

  it("restores the original agent when overlapping pause and resume requests both reject", async () => {
    const target = agentWithStatus("running");
    const pauseRequest = deferred<AgentActionResult>();
    const resumeRequest = deferred<AgentActionResult>();
    vi.mocked(postAgentAction).mockReturnValueOnce(pauseRequest.promise).mockReturnValueOnce(resumeRequest.promise);
    const { queryClient, result } = renderAction();

    const pauseMutation = result.current
      .mutateAsync(pauseVariables(target, "2026-07-10T12:17:00.000Z"))
      .catch((error: unknown) => error);
    await waitFor(() => expect(cachedSnapshot(queryClient).byId[target.id]?.status.kind).toBe("paused"));
    const resumeMutation = result.current
      .mutateAsync({
        agentId: target.id,
        request: { action: "resume" },
        optimisticStatus: {
          kind: "running",
          startedAt: target.startedAt,
          lastHeartbeatAt: "2026-07-10T12:17:01.000Z",
        },
      })
      .catch((error: unknown) => error);
    await waitFor(() => expect(postAgentAction).toHaveBeenCalledTimes(2));
    expect(cachedSnapshot(queryClient).byId[target.id]?.status.kind).toBe("paused");

    pauseRequest.reject(new Error("pause failed"));
    await act(async () => pauseMutation);
    resumeRequest.reject(new Error("resume failed"));
    await act(async () => resumeMutation);

    const restored = cachedSnapshot(queryClient);
    expect(restored.byId[target.id]).toEqual(target);
    expect(restored.summary.statusCounts.running).toBe(BASE.summary.statusCounts.running);
    expect(restored.summary.statusCounts.paused).toBe(BASE.summary.statusCounts.paused);
  });
});
