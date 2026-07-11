import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionStatus } from "./transport";
import { SseRealtimeTransport } from "./sse-transport";

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly url: string;
  readonly withCredentials = false;
  readyState = this.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.readyState = this.CLOSED;
  }

  emitOpen(): void {
    this.readyState = this.OPEN;
    this.onopen?.(new Event("open"));
  }

  emitMessage(data: string): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  emitError(): void {
    this.onerror?.(new Event("error"));
  }
}

function source(index: number): FakeEventSource {
  const instance = FakeEventSource.instances[index];
  if (!instance) throw new Error(`EventSource ${index} was not created`);
  return instance;
}

function connectTransport() {
  const statuses: ConnectionStatus[] = [];
  const events: string[] = [];
  const transport = new SseRealtimeTransport({
    heartbeatTimeoutMs: 60_000,
    initialBackoffMs: 100,
    maxBackoffMs: 800,
  });
  const disconnect = transport.connect({
    onEvent: (event) => events.push(event.eventId),
    onStatusChange: (status) => statuses.push(status),
  });
  return { disconnect, events, statuses };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SseRealtimeTransport backoff", () => {
  it("keeps increasing backoff across open/error flaps without inbound data", () => {
    const { disconnect } = connectTransport();
    source(0).emitOpen();
    source(0).emitError();
    vi.advanceTimersByTime(100);
    expect(FakeEventSource.instances).toHaveLength(2);

    source(1).emitOpen();
    source(1).emitError();
    vi.advanceTimersByTime(100);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(100);
    expect(FakeEventSource.instances).toHaveLength(3);
    disconnect();
  });

  it("resets backoff after real inbound liveness", () => {
    const { disconnect, events } = connectTransport();
    source(0).emitOpen();
    source(0).emitError();
    vi.advanceTimersByTime(100);
    source(1).emitOpen();
    source(1).emitMessage(
      JSON.stringify({
        type: "heartbeat",
        eventId: "live",
        sequence: 0,
        timestamp: "2026-07-10T12:00:00.000Z",
        correlationId: null,
        entityId: null,
        payload: { serverTime: "2026-07-10T12:00:00.000Z" },
      }),
    );
    expect(events).toEqual(["live"]);

    source(1).emitError();
    vi.advanceTimersByTime(99);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(3);
    disconnect();
  });

  it("clears every timer on a normal disconnect", () => {
    const { disconnect, statuses } = connectTransport();
    source(0).emitOpen();
    expect(vi.getTimerCount()).toBe(1);

    disconnect();
    disconnect();

    expect(vi.getTimerCount()).toBe(0);
    expect(statuses.at(-1)).toBe("closed");
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
