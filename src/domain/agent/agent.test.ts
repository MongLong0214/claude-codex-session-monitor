import { describe, expect, it } from "vitest";

import { AgentSchema } from "./agent";

const VALID_AGENT = {
  id: "agent-1",
  displayName: "Agent",
  source: "codex",
  role: "main",
  project: { cwd: "/workspace", name: "workspace", repoUrl: null },
  branch: null,
  commitSha: null,
  model: null,
  reasoningEffort: null,
  status: {
    kind: "running",
    startedAt: "2026-07-11T00:00:00.000Z",
    lastHeartbeatAt: "2026-07-11T00:00:00.000Z",
  },
  currentTask: null,
  tokensUsed: 0,
  costUsd: null,
  startedAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
  lastHeartbeatAt: null,
  runtimePids: [1],
  parentId: null,
  childIds: [],
  cliVersion: null,
  approvalMode: null,
  rolloutPath: "",
} as const;

describe("AgentSchema", () => {
  it.each(["", "x".repeat(257)])("rejects invalid agent id length", (agentId) => {
    // Given
    const agent = { ...VALID_AGENT, id: agentId };

    // When
    const parsed = AgentSchema.safeParse(agent);

    // Then
    expect(parsed.success).toBe(false);
  });

  it.each([0, -1])("rejects non-positive runtime pid %i", (runtimePid) => {
    // Given
    const agent = { ...VALID_AGENT, runtimePids: [runtimePid] };

    // When
    const parsed = AgentSchema.safeParse(agent);

    // Then
    expect(parsed.success).toBe(false);
  });

  it("accepts a positive runtime pid", () => {
    // Given / When
    const parsed = AgentSchema.safeParse(VALID_AGENT);

    // Then
    expect(parsed.success).toBe(true);
  });
});
