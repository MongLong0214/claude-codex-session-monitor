import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMockSnapshot } from "@/data-access/mock-adapter";
import type { DashboardSnapshot } from "@/domain/dashboard";
import { RealtimeEventSchema, type RealtimeEvent } from "@/domain/realtime/events";

const { getSnapshot } = vi.hoisted(() => ({
  getSnapshot: vi.fn<() => Promise<DashboardSnapshot>>(),
}));

vi.mock("@/data-access/repositories", () => ({
  dashboardRepository: { getSnapshot },
}));

import { GET } from "./route";

const NOW_MS = Date.parse("2026-07-11T00:00:00.000Z");

function deferred<T>(): readonly [Promise<T>, (value: T) => void] {
  let resolve = (_value: T): void => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return [promise, resolve] as const;
}

function localRequest(controller: AbortController): Request {
  return new Request("http://127.0.0.1/api/dashboard/events", {
    headers: { host: "127.0.0.1" },
    signal: controller.signal,
  });
}

function eventsFrom(body: string): RealtimeEvent[] {
  return body
    .trim()
    .split("\n\n")
    .map((frame) => {
      const data = frame.split("\n").find((line) => line.startsWith("data: "));
      return RealtimeEventSchema.parse(JSON.parse(data?.slice(6) ?? ""));
    });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  getSnapshot.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/dashboard/events", () => {
  it("frames authoritative projects on the initial burst and only when they change", async () => {
    // Given
    const initial = buildMockSnapshot(NOW_MS);
    const changed: DashboardSnapshot = {
      ...initial,
      projects: [...initial.projects, { cwd: "/repo/new", name: "new", repoUrl: null }],
      revision: initial.revision + 1,
      lastSyncedAt: "2026-07-11T00:00:01.000Z",
    };
    const [initialRead, resolveInitial] = deferred<DashboardSnapshot>();
    getSnapshot.mockReturnValueOnce(initialRead).mockResolvedValue(changed);
    const controller = new AbortController();
    const response = await GET(localRequest(controller));

    // When
    resolveInitial(initial);
    await initialRead;
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(3_000);
    controller.abort();
    const body = await response.text();

    // Then
    expect(getSnapshot).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(getSnapshot).toHaveBeenCalledTimes(3);
    expect(
      body
        .trim()
        .split("\n\n")
        .every((frame) => /^id: \d+\nevent: message\ndata: .+$/s.test(frame)),
    ).toBe(true);
    const projectEvents = eventsFrom(body).filter((event) => event.type === "projects_updated");
    expect(projectEvents.map((event) => event.payload)).toEqual([initial.projects, changed.projects]);
  });

  it("keeps project fingerprints and abort cleanup isolated per client", async () => {
    // Given
    const snapshot = buildMockSnapshot(NOW_MS);
    const [firstRead, resolveFirst] = deferred<DashboardSnapshot>();
    const [secondRead, resolveSecond] = deferred<DashboardSnapshot>();
    getSnapshot.mockReturnValueOnce(firstRead).mockReturnValueOnce(secondRead).mockResolvedValue(snapshot);
    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstResponse = await GET(localRequest(firstController));
    const secondResponse = await GET(localRequest(secondController));

    // When
    resolveFirst(snapshot);
    resolveSecond(snapshot);
    await Promise.all([firstRead, secondRead]);
    await Promise.resolve();
    firstController.abort();
    await vi.advanceTimersByTimeAsync(1_500);
    secondController.abort();
    const [firstBody, secondBody] = await Promise.all([firstResponse.text(), secondResponse.text()]);

    // Then
    expect(getSnapshot).toHaveBeenCalledTimes(3);
    expect(eventsFrom(firstBody).filter((event) => event.type === "projects_updated")).toHaveLength(1);
    expect(eventsFrom(secondBody).filter((event) => event.type === "projects_updated")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(getSnapshot).toHaveBeenCalledTimes(3);
  });
});
