import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { DashboardSnapshot } from "@/domain/dashboard";
import type { RealtimeEvent } from "@/domain/realtime/events";
import { EventSequencer } from "@/lib/realtime/event-sequencer";
import { SseRealtimeTransport } from "@/lib/realtime/sse-transport";
import type { ConnectionStatus, RealtimeTransport } from "@/lib/realtime/transport";
import { dashboardKeys } from "./keys";
import { applyRealtimeEvents } from "./reducer";
import { useDashboardSnapshot } from "./use-dashboard-snapshot";

/**
 * setTimeout, not requestAnimationFrame: rAF is paused in background tabs, so a backgrounded
 * dashboard would buffer a reconnect's resync burst indefinitely instead of draining it.
 */
const FLUSH_WINDOW_MS = 32;
const RECOVERY_RETRY_MS = 1_000;
const MAX_RECOVERY_BACKLOG = 512;

export interface RealtimeSyncState {
  status: ConnectionStatus;
  /** Server timestamp of the most recent inbound message, heartbeats included — the liveness clock. */
  lastEventAt: string | null;
}

/**
 * Mount once, beneath QueryProvider. Connection is gated on the snapshot query having landed,
 * so the resync burst never races an in-flight initial fetch; the `prev ? ... : prev` guard in
 * the flush keeps that safe even if the cache is evicted mid-stream.
 *
 * Cache coherence has two recovery paths, both landing on the snapshot endpoint as the authority:
 *   - reconnect: the resync burst is upserts only, so it cannot express agents deleted while we
 *     were disconnected. Discard pending events and refetch.
 *   - sequence gap: events were lost, so an unknown number of upserts/removals never arrived.
 *     Discard pending events and refetch rather than replaying stale state over the authority.
 * Events arriving during either refetch queue one more serialized authority pass.
 * Duplicates and out-of-order events are dropped outright — never merged.
 *
 * `transport` is captured once per mount rather than defaulted per render — a fresh
 * `new SseRealtimeTransport()` on every render would change the effect's identity and
 * reconnect in a loop. Pass a fake here to test without a network.
 */
export function useRealtimeSync(transport?: RealtimeTransport): RealtimeSyncState {
  const queryClient = useQueryClient();
  const [resolvedTransport] = useState<RealtimeTransport>(() => transport ?? new SseRealtimeTransport());
  const [sequencer] = useState(() => new EventSequencer());

  const { data } = useDashboardSnapshot();
  const hasSnapshot = data !== undefined;

  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);

  const bufferRef = useRef<RealtimeEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hasSnapshot) {
      return;
    }

    let disposed = false;
    let recoveryActive = false;
    let recoveryQueued = false;
    let recoveryRetryTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      flushTimerRef.current = null;
      const batch = bufferRef.current;
      if (batch.length === 0) {
        return;
      }
      bufferRef.current = [];

      queryClient.setQueryData<DashboardSnapshot>(dashboardKeys.snapshot(), (prev) =>
        prev ? applyRealtimeEvents(prev, batch) : prev,
      );
    };

    const scheduleFlush = () => {
      if (flushTimerRef.current !== null) {
        return;
      }
      flushTimerRef.current = setTimeout(flush, FLUSH_WINDOW_MS);
    };

    function runRecovery(): void {
      recoveryQueued = false;
      void queryClient
        .invalidateQueries({ queryKey: dashboardKeys.snapshot() }, { throwOnError: true })
        .then(
          () => {
            if (disposed) {
              return;
            }
            if (recoveryQueued) {
              runRecovery();
              return;
            }
            recoveryActive = false;
            flush();
          },
          () => {
            if (disposed) {
              return;
            }
            recoveryRetryTimer = setTimeout(() => {
              recoveryRetryTimer = null;
              runRecovery();
            }, RECOVERY_RETRY_MS);
          },
        );
    }

    function requestRecovery(queueNext = false): void {
      if (recoveryActive) {
        recoveryQueued = true;
        return;
      }
      recoveryActive = true;
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      bufferRef.current = [];
      runRecovery();
      if (queueNext) {
        recoveryQueued = true;
      }
    }

    const bufferEvent = (event: RealtimeEvent) => {
      if (bufferRef.current.length === MAX_RECOVERY_BACKLOG) {
        requestRecovery(true);
        return;
      }
      bufferRef.current.push(event);
    };

    const advanceLastEventAt = (timestamp: string) => {
      setLastEventAt((current) => (current === null || Date.parse(timestamp) > Date.parse(current) ? timestamp : current));
    };

    const disconnect = resolvedTransport.connect({
      onEvent: (event) => {
        const { decision, missing } = sequencer.classify(event);

        if (decision === "duplicate" || decision === "out_of_order") {
          return;
        }
        if (decision === "gap") {
          console.warn(`[realtime-sync] sequence gap: ${missing} event(s) lost, refetching snapshot.`);
          requestRecovery(event.type !== "heartbeat");
        }

        advanceLastEventAt(event.timestamp);

        // Heartbeats carry no cache payload; they only advance the liveness clock, and
        // buffering them would churn `revision` for nothing. They still participate in
        // sequencing above, so a gap observed on a heartbeat also triggers a resync.
        if (event.type === "heartbeat") {
          return;
        }
        if (recoveryActive) {
          requestRecovery();
          return;
        }
        bufferEvent(event);
        if (!recoveryActive) {
          scheduleFlush();
        }
      },
      onStatusChange: (next) => {
        setStatus(next);

        if (next === "open") {
          // The server restarts sequences per connection; carrying the counter across would
          // classify the entire resync burst as stale and discard it.
          sequencer.reset();
          requestRecovery();
        }
      },
    });

    return () => {
      disposed = true;
      disconnect();
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (recoveryRetryTimer !== null) {
        clearTimeout(recoveryRetryTimer);
        recoveryRetryTimer = null;
      }
      bufferRef.current = [];
      sequencer.reset();
    };
  }, [hasSnapshot, queryClient, resolvedTransport, sequencer]);

  return { status, lastEventAt };
}
