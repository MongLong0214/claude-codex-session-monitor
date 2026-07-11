import { describe, expect, it } from "vitest";
import { buildMockSnapshot } from "@/data-access/mock-adapter";
import { AgentSchema } from "@/domain/agent/agent";
import type { Incident } from "@/domain/incident/incident";
import { RealtimeEventSchema } from "./events";

const META = {
  eventId: "event-1",
  sequence: 0,
  timestamp: "2026-07-11T00:00:00.000Z",
  correlationId: null,
} as const;

const SNAPSHOT = buildMockSnapshot(Date.parse(META.timestamp));
const AGENT = AgentSchema.parse(SNAPSHOT.byId["mock-main-monitor"]);
const INCIDENT: Incident = {
  id: "incident-1",
  severity: "high",
  type: "stale_heartbeat",
  detectedAt: META.timestamp,
  affectedAgentIds: [AGENT.id],
  affectedProjectIds: [AGENT.project.cwd],
  summary: "heartbeat is stale",
  evidence: "last heartbeat was 15 minutes ago",
  suggestedAction: "inspect the session",
};

describe("RealtimeEventSchema", () => {
  it("round-trips projects_updated when the server sends authoritative projects", () => {
    // Given
    const event = { ...META, type: "projects_updated", entityId: null, payload: SNAPSHOT.projects };

    // When / Then
    expect(RealtimeEventSchema.parse(event)).toEqual(event);
  });

  it("round-trips agent_upserted when entityId matches payload.id", () => {
    // Given
    const event = { ...META, type: "agent_upserted", entityId: AGENT.id, payload: AGENT };

    // When / Then
    expect(RealtimeEventSchema.parse(event)).toEqual(event);
  });

  it("rejects agent_upserted when entityId differs from payload.id", () => {
    // Given
    const event = { ...META, type: "agent_upserted", entityId: "different-agent", payload: AGENT };

    // When
    const result = RealtimeEventSchema.safeParse(event);

    // Then
    expect(result.success).toBe(false);
  });

  it("round-trips incident_upserted when entityId matches payload.id", () => {
    // Given
    const event = { ...META, type: "incident_upserted", entityId: INCIDENT.id, payload: INCIDENT };

    // When / Then
    expect(RealtimeEventSchema.parse(event)).toEqual(event);
  });

  it("rejects incident_upserted when entityId differs from payload.id", () => {
    // Given
    const event = { ...META, type: "incident_upserted", entityId: "different-incident", payload: INCIDENT };

    // When
    const result = RealtimeEventSchema.safeParse(event);

    // Then
    expect(result.success).toBe(false);
  });
});
