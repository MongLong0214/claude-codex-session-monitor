import { describe, expect, it } from "vitest";

import { AgentActionResultSchema, BulkAgentActionRequestSchema } from "./actions";

describe("agent action schemas", () => {
  it.each(["", "x".repeat(257)])("rejects invalid agent id length", (agentId) => {
    // Given
    const request = { agentIds: [agentId], action: "pause" };

    // When
    const parsed = BulkAgentActionRequestSchema.safeParse(request);

    // Then
    expect(parsed.success).toBe(false);
  });

  it("rejects more than 100 bulk agent ids", () => {
    // Given
    const request = { agentIds: Array.from({ length: 101 }, (_, index) => `agent-${index}`), action: "pause" };

    // When
    const parsed = BulkAgentActionRequestSchema.safeParse(request);

    // Then
    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate bulk agent ids", () => {
    // Given
    const request = { agentIds: ["agent-1", "agent-1"], action: "pause" };

    // When
    const parsed = BulkAgentActionRequestSchema.safeParse(request);

    // Then
    expect(parsed.success).toBe(false);
  });

  it("accepts 100 unique bounded bulk agent ids", () => {
    // Given
    const request = { agentIds: Array.from({ length: 100 }, (_, index) => `agent-${index}`), action: "pause" };

    // When
    const parsed = BulkAgentActionRequestSchema.safeParse(request);

    // Then
    expect(parsed.success).toBe(true);
  });

  it("rejects an overlong agent id in an action result", () => {
    // Given
    const result = { agentId: "x".repeat(257), action: "pause", status: "skipped", message: "skip" };

    // When
    const parsed = AgentActionResultSchema.safeParse(result);

    // Then
    expect(parsed.success).toBe(false);
  });
});
