import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "@/domain/agent/agent";
import type { DashboardSnapshot } from "@/domain/dashboard";

import { localDashboardRepository } from "./local-adapter";
import { localAgentLogRepository, logLinesFromTail } from "./local-agent-logs";

/** Shapes copied from real rollout JSONL lines on this machine, not invented. */
function rolloutLine(entry: unknown): string {
  return JSON.stringify(entry);
}

const AGENT_MESSAGE = rolloutLine({
  timestamp: "2026-07-10T07:47:46.378Z",
  type: "event_msg",
  payload: { type: "agent_message", message: "Running tests" },
});

const TOOL_CALL = rolloutLine({
  timestamp: "2026-07-10T07:48:26.526Z",
  type: "response_item",
  payload: { type: "custom_tool_call", name: "exec" },
});

const TASK_COMPLETE = rolloutLine({
  timestamp: "2026-07-10T07:49:00.000Z",
  type: "event_msg",
  payload: { type: "task_complete" },
});

/** describeRolloutEvent has no text for these, so they must not become log rows. */
const REASONING = rolloutLine({
  timestamp: "2026-07-10T07:48:00.000Z",
  type: "response_item",
  payload: { type: "reasoning" },
});

const TOKEN_COUNT = rolloutLine({
  timestamp: "2026-07-10T07:48:10.000Z",
  type: "event_msg",
  payload: { type: "token_count" },
});

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  vi.restoreAllMocks();
});

function snapshotWithRolloutPath(rolloutPath: string): DashboardSnapshot {
  const timestamp = "2026-07-10T07:47:46.378Z";
  const agent: Agent = {
    id: "missing-rollout",
    displayName: "missing-rollout",
    source: "codex",
    role: "main",
    project: { cwd: path.dirname(rolloutPath), name: "missing", repoUrl: null },
    branch: null,
    commitSha: null,
    model: null,
    reasoningEffort: null,
    status: { kind: "running", startedAt: timestamp, lastHeartbeatAt: timestamp },
    currentTask: null,
    tokensUsed: 0,
    costUsd: null,
    startedAt: timestamp,
    updatedAt: timestamp,
    lastHeartbeatAt: timestamp,
    runtimePids: [],
    parentId: null,
    childIds: [],
    cliVersion: null,
    approvalMode: null,
    rolloutPath,
  };
  return {
    byId: { [agent.id]: agent },
    allIds: [agent.id],
    projects: [agent.project],
    incidents: [],
    summary: {
      totalAgents: 1,
      activeProjects: 1,
      statusCounts: {
        running: 1,
        waiting: 0,
        approval_required: 0,
        blocked: 0,
        failed: 0,
        completed: 0,
        paused: 0,
        stale: 0,
        offline: 0,
      },
      sessionCostUsd: null,
    },
    warnings: [],
    revision: 1,
    lastSyncedAt: timestamp,
  };
}

describe("logLinesFromTail", () => {
  it("keeps chronological order and maps events through describeRolloutEvent", () => {
    const { lines, droppedCount } = logLinesFromTail([AGENT_MESSAGE, TOOL_CALL, TASK_COMPLETE].join("\n"), 500);

    expect(droppedCount).toBe(0);
    expect(lines.map((line) => line.text)).toEqual(["Running tests", "Tool call: exec", "Task completion signal"]);
    expect(lines[0]?.timestamp).toBe("2026-07-10T07:47:46.378Z");
  });

  it("labels every line 'info' — the rollout vocabulary carries no severity", () => {
    const { lines } = logLinesFromTail([AGENT_MESSAGE, TOOL_CALL].join("\n"), 500);
    expect(lines.every((line) => line.level === "info")).toBe(true);
  });

  it("omits entries the describer has no text for instead of dumping raw JSON", () => {
    const { lines } = logLinesFromTail([REASONING, AGENT_MESSAGE, TOKEN_COUNT].join("\n"), 500);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("Running tests");
  });

  it("skips the truncated leading record and non-JSON noise without throwing", () => {
    const { lines } = logLinesFromTail(['{"type":"event_msg","paylo', "", AGENT_MESSAGE].join("\n"), 500);
    expect(lines).toHaveLength(1);
  });

  it("keeps the newest lines when the limit is exceeded and reports the drop", () => {
    const { lines, droppedCount } = logLinesFromTail([AGENT_MESSAGE, TOOL_CALL, TASK_COMPLETE].join("\n"), 2);

    expect(droppedCount).toBe(1);
    expect(lines.map((line) => line.text)).toEqual(["Tool call: exec", "Task completion signal"]);
  });

  it("gives colliding timestamps distinct ids so the list never reuses a key", () => {
    const duplicate = rolloutLine({
      timestamp: "2026-07-10T07:47:46.378Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "Second" },
    });

    const { lines } = logLinesFromTail([AGENT_MESSAGE, duplicate].join("\n"), 500);
    expect(new Set(lines.map((line) => line.id)).size).toBe(2);
  });

  it("assigns same-timestamp ids before slicing so a sliding limit preserves identities", () => {
    const messages = ["First", "Second", "Third"].map((message) =>
      rolloutLine({
        timestamp: "2026-07-10T07:47:46.378Z",
        type: "event_msg",
        payload: { type: "agent_message", message },
      }),
    );

    const { lines } = logLinesFromTail(messages.join("\n"), 2);

    expect(lines.map((line) => line.id)).toEqual([
      "2026-07-10T07:47:46.378Z#1",
      "2026-07-10T07:47:46.378Z#2",
    ]);
  });

  it("returns nothing for an empty tail", () => {
    expect(logLinesFromTail("", 500)).toEqual({ lines: [], droppedCount: 0 });
  });
});

describe("localAgentLogRepository", () => {
  it("rejects a vanished rollout file instead of reporting an empty log", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "missing-rollout-"));
    cleanups.push(() => rm(directory, { force: true, recursive: true }));
    const missingPath = path.join(directory, "rollout.jsonl");
    vi.spyOn(localDashboardRepository, "getSnapshot").mockResolvedValue(snapshotWithRolloutPath(missingPath));

    const read = localAgentLogRepository.readLines("missing-rollout", 500);

    await expect(read).rejects.toMatchObject({ code: "ENOENT" });
  });
});
