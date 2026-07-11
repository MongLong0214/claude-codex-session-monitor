import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMockSnapshot } from "@/data-access/mock-adapter";
import type { Agent } from "@/domain/agent/agent";
import type { DashboardSnapshot } from "@/domain/dashboard";
import type { RealtimeEvent } from "@/domain/realtime/events";
import type { RealtimeTransport, RealtimeTransportHandlers } from "@/lib/realtime/transport";
import { dashboardKeys } from "./keys";

vi.mock("@/lib/query/api", () => ({
  DASHBOARD_EVENTS_ENDPOINT: "/api/dashboard/events",
  fetchDashboardSnapshot: vi.fn(),
}));

import { fetchDashboardSnapshot } from "./api";
import { applyRealtimeEvents } from "./reducer";
import { useRealtimeSync } from "./use-realtime-sync";

const BASE = buildMockSnapshot(Date.parse("2026-07-10T12:00:00.000Z"));
function firstAgent(): Agent {
  const agent = BASE.byId[BASE.allIds[0] ?? ""];
  if (!agent) throw new Error("mock snapshot must contain an agent");
  return agent;
}
const BASE_AGENT = firstAgent();

function deferredSnapshot(): {
  readonly promise: Promise<DashboardSnapshot>;
  resolve(snapshot: DashboardSnapshot): void;
} {
  let settle: ((snapshot: DashboardSnapshot) => void) | undefined;
  const promise = new Promise<DashboardSnapshot>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve(snapshot) {
      if (!settle) throw new Error("deferred snapshot resolver missing");
      settle(snapshot);
    },
  };
}

class FakeTransport implements RealtimeTransport {
  handlers: RealtimeTransportHandlers | null = null;
  connections = 0;
  disconnects = 0;

  connect(handlers: RealtimeTransportHandlers) {
    this.handlers = handlers;
    this.connections += 1;
    return () => {
      this.disconnects += 1;
      if (this.handlers === handlers) {
        this.handlers = null;
      }
    };
  }

  status(status: Parameters<RealtimeTransportHandlers["onStatusChange"]>[0]): void {
    if (!this.handlers) throw new Error("transport is not connected");
    this.handlers.onStatusChange(status);
  }

  event(event: RealtimeEvent): void {
    if (!this.handlers) throw new Error("transport is not connected");
    this.handlers.onEvent(event);
  }
}

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false, staleTime: Infinity } },
  });
}

function renderSync(queryClient: QueryClient, transport: FakeTransport) {
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return renderHook(() => useRealtimeSync(transport), { wrapper: Wrapper });
}

function cachedSnapshot(queryClient: QueryClient): DashboardSnapshot {
  const snapshot = queryClient.getQueryData<DashboardSnapshot>(dashboardKeys.snapshot());
  if (!snapshot) throw new Error("snapshot missing from query cache");
  return snapshot;
}

function heartbeat(sequence: number, timestamp: string): RealtimeEvent {
  return {
    type: "heartbeat",
    eventId: `heartbeat-${sequence}`,
    sequence,
    timestamp,
    correlationId: null,
    entityId: null,
    payload: { serverTime: timestamp },
  };
}

function upsert(sequence: number, id: string, timestamp: string): RealtimeEvent {
  return {
    type: "agent_upserted",
    eventId: `upsert-${sequence}`,
    sequence,
    timestamp,
    correlationId: null,
    entityId: id,
    payload: { ...BASE_AGENT, id, displayName: id, updatedAt: timestamp },
  };
}

async function openAndReconcile(queryClient: QueryClient, transport: FakeTransport): Promise<void> {
  vi.mocked(fetchDashboardSnapshot).mockResolvedValueOnce(BASE);
  act(() => transport.status("open"));
  await waitFor(() => expect(fetchDashboardSnapshot).toHaveBeenCalled());
  await waitFor(() => expect(queryClient.isFetching({ queryKey: dashboardKeys.snapshot() })).toBe(0));
}

beforeEach(() => {
  vi.mocked(fetchDashboardSnapshot).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useRealtimeSync snapshot recovery", () => {
  it("keeps one connection when a background refetch errors but cached data still exists", async () => {
    const queryClient = createClient();
    const transport = new FakeTransport();
    queryClient.setQueryData(dashboardKeys.snapshot(), BASE);
    renderSync(queryClient, transport);
    await waitFor(() => expect(transport.connections).toBe(1));
    vi.mocked(fetchDashboardSnapshot).mockRejectedValueOnce(new Error("background refetch failed"));

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: dashboardKeys.snapshot() });
    });

    expect(cachedSnapshot(queryClient)).toBeDefined();
    expect(transport.connections).toBe(1);
    expect(transport.disconnects).toBe(0);
  });

  it("reconciles the cached snapshot on the first successful SSE open", async () => {
    const queryClient = createClient();
    const transport = new FakeTransport();
    const authoritative = { ...BASE, warnings: ["first-open-reconciled"], revision: BASE.revision + 1 };
    queryClient.setQueryData(dashboardKeys.snapshot(), BASE);
    vi.mocked(fetchDashboardSnapshot).mockResolvedValueOnce(authoritative);
    renderSync(queryClient, transport);
    await waitFor(() => expect(transport.connections).toBe(1));

    act(() => transport.status("open"));

    await waitFor(() => expect(cachedSnapshot(queryClient).warnings).toEqual(["first-open-reconciled"]));
  });

  it("waits for a final authority pass that includes events arriving during gap recovery", async () => {
    const queryClient = createClient();
    const transport = new FakeTransport();
    queryClient.setQueryData(dashboardKeys.snapshot(), BASE);
    renderSync(queryClient, transport);
    await openAndReconcile(queryClient, transport);
    vi.useFakeTimers();
    const gapRefetch = deferredSnapshot();
    const gapEvent = upsert(2, "gap-agent", "2026-07-10T12:01:02.000Z");
    const afterGapEvent = upsert(3, "after-gap-agent", "2026-07-10T12:01:03.000Z");
    vi.mocked(fetchDashboardSnapshot).mockReturnValueOnce(gapRefetch.promise);
    vi.mocked(fetchDashboardSnapshot).mockResolvedValueOnce(applyRealtimeEvents(BASE, [gapEvent, afterGapEvent]));

    act(() => {
      transport.event(heartbeat(0, "2026-07-10T12:01:00.000Z"));
      transport.event(gapEvent);
      transport.event(afterGapEvent);
      vi.advanceTimersByTime(32);
    });

    expect(cachedSnapshot(queryClient).byId["gap-agent"]).toBeUndefined();
    expect(cachedSnapshot(queryClient).byId["after-gap-agent"]).toBeUndefined();
    vi.useRealTimers();
    await act(async () => gapRefetch.resolve(BASE));
    await waitFor(() => expect(fetchDashboardSnapshot).toHaveBeenCalledTimes(3));
    expect(cachedSnapshot(queryClient).byId["gap-agent"]).toBeDefined();
    expect(cachedSnapshot(queryClient).byId["after-gap-agent"]).toBeDefined();
  });

  it("lets the final authority pass discard stale buffered and in-recovery events", async () => {
    const queryClient = createClient();
    const transport = new FakeTransport();
    queryClient.setQueryData(dashboardKeys.snapshot(), BASE);
    renderSync(queryClient, transport);
    await openAndReconcile(queryClient, transport);
    const firstRecovery = deferredSnapshot();
    vi.mocked(fetchDashboardSnapshot).mockReturnValueOnce(firstRecovery.promise).mockResolvedValueOnce(BASE);

    act(() => {
      transport.event(upsert(0, "stale-before-gap", "2026-07-10T12:01:00.000Z"));
      transport.event(heartbeat(2, "2026-07-10T12:01:02.000Z"));
      transport.event(upsert(3, "arrived-during-recovery", "2026-07-10T12:01:03.000Z"));
    });
    expect(cachedSnapshot(queryClient).byId["stale-before-gap"]).toBeUndefined();
    expect(cachedSnapshot(queryClient).byId["arrived-during-recovery"]).toBeUndefined();

    await act(async () => firstRecovery.resolve(BASE));

    await waitFor(() => expect(fetchDashboardSnapshot).toHaveBeenCalledTimes(3));
    expect(cachedSnapshot(queryClient).byId["stale-before-gap"]).toBeUndefined();
    expect(cachedSnapshot(queryClient).byId["arrived-during-recovery"]).toBeUndefined();
  });

  it("retains recovery after a failed gap refetch and retries it", async () => {
    const queryClient = createClient();
    const transport = new FakeTransport();
    queryClient.setQueryData(dashboardKeys.snapshot(), BASE);
    renderSync(queryClient, transport);
    await openAndReconcile(queryClient, transport);
    vi.useFakeTimers();
    const retryEvent = upsert(2, "retry-agent", "2026-07-10T12:02:02.000Z");
    vi.mocked(fetchDashboardSnapshot)
      .mockRejectedValueOnce(new Error("recovery failed"))
      .mockResolvedValueOnce(applyRealtimeEvents(BASE, [retryEvent]));

    act(() => {
      transport.event(heartbeat(0, "2026-07-10T12:02:00.000Z"));
      transport.event(retryEvent);
    });
    await act(async () => {});
    expect(fetchDashboardSnapshot).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(fetchDashboardSnapshot).toHaveBeenCalledTimes(3);
    expect(cachedSnapshot(queryClient).byId["retry-agent"]).toBeDefined();
  });

  it("requests a fresh authority pass when the recovery backlog reaches its bound", async () => {
    const queryClient = createClient();
    const transport = new FakeTransport();
    queryClient.setQueryData(dashboardKeys.snapshot(), BASE);
    renderSync(queryClient, transport);
    await openAndReconcile(queryClient, transport);
    const firstRecovery = deferredSnapshot();
    vi.mocked(fetchDashboardSnapshot).mockReturnValueOnce(firstRecovery.promise);
    vi.mocked(fetchDashboardSnapshot).mockResolvedValueOnce(BASE);

    act(() => {
      for (let sequence = 0; sequence <= 512; sequence += 1) {
        transport.event(upsert(sequence, `bounded-${sequence}`, "2026-07-10T12:03:02.000Z"));
      }
    });
    await act(async () => firstRecovery.resolve(BASE));

    await waitFor(() => expect(fetchDashboardSnapshot).toHaveBeenCalledTimes(3));
  });
});

it("never moves lastEventAt backward when a later sequence has an older timestamp", async () => {
  const queryClient = createClient();
  const transport = new FakeTransport();
  queryClient.setQueryData(dashboardKeys.snapshot(), BASE);
  const { result } = renderSync(queryClient, transport);
  await waitFor(() => expect(transport.connections).toBe(1));

  act(() => {
    transport.event(heartbeat(0, "2026-07-10T12:05:00.000Z"));
    transport.event(heartbeat(1, "2026-07-10T12:04:00.000Z"));
  });

  expect(result.current.lastEventAt).toBe("2026-07-10T12:05:00.000Z");
});
