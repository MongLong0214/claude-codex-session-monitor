import { describe, expect, it } from "vitest";
import { buildMockSnapshot } from "@/data-access/mock-adapter";
import { RealtimeEventSchema } from "@/domain/realtime/events";
import { applyRealtimeEvent } from "./reducer";

describe("applyRealtimeEvent", () => {
  it("updates only the projects slice when projects_updated arrives", () => {
    // Given
    const snapshot = buildMockSnapshot(Date.parse("2026-07-11T00:00:00.000Z"));
    const event = RealtimeEventSchema.parse({
      eventId: "event-1",
      sequence: 0,
      timestamp: "2026-07-11T00:00:01.000Z",
      correlationId: null,
      type: "projects_updated",
      entityId: null,
      payload: [{ cwd: "/repo/new", name: "new", repoUrl: null }],
    });

    // When
    const next = applyRealtimeEvent(snapshot, event);

    // Then
    expect(next).not.toBe(snapshot);
    expect(next.projects).toBe(event.payload);
    expect(next.byId).toBe(snapshot.byId);
    expect(next.allIds).toBe(snapshot.allIds);
    expect(next.incidents).toBe(snapshot.incidents);
    expect(next.summary).toBe(snapshot.summary);
    expect(next.warnings).toBe(snapshot.warnings);
    expect(next.revision).toBe(snapshot.revision + 1);
    expect(next.lastSyncedAt).toBe(event.timestamp);
  });
});
