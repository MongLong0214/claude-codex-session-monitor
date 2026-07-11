import { execFile, type ExecFileOptions } from "node:child_process";
import { constants } from "node:fs";
import { mkdtemp, open as openFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "@/domain/agent/agent";
import { DashboardSnapshotSchema } from "@/domain/dashboard";

import {
  ACTION_HANDLERS,
  activityCandidatesFromTail,
  buildStateQuery,
  classifyNode,
  collectLatestActivities,
  describeRolloutEvent,
  getSnapshot,
  localDashboardRepository,
  mergeClaudeContent,
  parseProcessRows,
  readTail,
  run,
  selectLatestActivities,
  selectRootThreads,
  signalAgentProcesses,
} from "./local-adapter";
import { STALE_HEARTBEAT_THRESHOLD_MS } from "./incident-detection";

/**
 * Ported from the retired legacy suite (test/session-data.test.mjs) when server.mjs + lib/ were
 * removed. These cover the core Codex engine — status classification, root selection, rollout-event
 * parsing, parent→child activity routing, and schema-resilient SQL generation — which no other file
 * in the Vitest suite exercised. Only functions already exported by local-adapter.ts are used, so
 * production code is untouched.
 */

const now = 1_800_000_000_000;
const execFileAsync = promisify(execFile);
const MAX_BUFFER = 8 * 1024 * 1024;

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

interface ThreadInput {
  id: string;
  cwd?: string | null;
  updatedAt?: number | null;
  title?: string | null;
  agentNickname?: string | null;
}

/** Full ThreadRow shape (camelCase, as the TypeScript port emits) so selectRootThreads type-checks. */
function thread(input: ThreadInput) {
  return {
    id: input.id,
    rolloutPath: null,
    createdAt: null,
    updatedAt: input.updatedAt ?? null,
    cwd: input.cwd ?? null,
    title: input.title ?? null,
    tokensUsed: 0,
    agentNickname: input.agentNickname ?? null,
    model: null,
    reasoningEffort: null,
    cliVersion: null,
    approvalMode: null,
    gitBranch: null,
    gitSha: null,
    gitOriginUrl: null,
    firstUserMessage: null,
    preview: null,
  };
}

function edge(parentThreadId: string, childThreadId: string, status: string | null = null) {
  return { parentThreadId, childThreadId, status };
}

function codexProcess(pid: number, cwd: string | null) {
  return { pid, ppid: 1, state: "R", elapsed: "00:00", cpuPercent: 0, memoryPercent: 0, command: "codex", cwd };
}

async function queryJson(databasePath: string, sql: string): Promise<Record<string, unknown>[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-json", databasePath, sql], { maxBuffer: MAX_BUFFER });
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
}

async function createDatabase(schema: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "codex-session-monitor-"));
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  const databasePath = path.join(directory, "state_test.sqlite");
  await execFileAsync("sqlite3", [databasePath, schema]);
  return databasePath;
}

function actionAgent(id: string, cwd: string, runtimePids: number[]): Agent {
  const timestamp = new Date(now).toISOString();
  return {
    id,
    displayName: id,
    source: "codex",
    role: "main",
    project: { cwd, name: path.basename(cwd), repoUrl: null },
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
    runtimePids,
    parentId: null,
    childIds: [],
    cliVersion: null,
    approvalMode: null,
    rolloutPath: "",
  };
}

function contentWithAgent(agent: Agent) {
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
  };
}

describe("process discovery safety", () => {
  it("rejects a nonpositive PID at the ps boundary", () => {
    const rows = parseProcessRows("0 1 R 00:01 0.0 0.0 codex");

    expect(rows).toEqual([]);
  });

  it("classifies the executable field rather than argv text containing codex", () => {
    const rows = parseProcessRows(
      [
        "41 1 R 00:01 0.0 0.0 /bin/sh -c codex --help",
        "42 1 R 00:01 0.0 0.0 /opt/homebrew/bin/codex",
      ].join("\n"),
    );

    expect(rows.map((row) => row.pid)).toEqual([42]);
  });
});

describe("process control safety", () => {
  it("does not signal a reused PID whose refreshed canonical cwd no longer matches", async () => {
    const liveCwd = await mkdtemp(path.join(tmpdir(), "codex-live-cwd-"));
    const reusedCwd = await mkdtemp(path.join(tmpdir(), "codex-reused-cwd-"));
    cleanups.push(() => rm(liveCwd, { force: true, recursive: true }));
    cleanups.push(() => rm(reusedCwd, { force: true, recursive: true }));
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await signalAgentProcesses(
      actionAgent("root", liveCwd, [321]),
      "SIGTERM",
      "SIGTERM",
      [codexProcess(321, reusedCwd)],
    );

    expect(kill).not.toHaveBeenCalled();
    expect(result.status).toBe("skipped");
  });

  it("signals a duplicate PID only once after refreshing the process inventory", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "codex-duplicate-cwd-"));
    cleanups.push(() => rm(cwd, { force: true, recursive: true }));
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await signalAgentProcesses(
      actionAgent("root", cwd, [321, 321]),
      "SIGSTOP",
      "SIGSTOP",
      [codexProcess(321, cwd), codexProcess(321, cwd)],
    );

    expect(result.status).toBe("success");
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(321, "SIGSTOP");
  });

  it("does not signal one shared PID repeatedly during a bulk action", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "codex-bulk-cwd-"));
    cleanups.push(() => rm(cwd, { force: true, recursive: true }));
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const handledPids = new Set<number>();
    const processes = [codexProcess(321, cwd)];

    const results = await Promise.all([
      signalAgentProcesses(actionAgent("root", cwd, [321]), "SIGCONT", "SIGCONT", processes, handledPids),
      signalAgentProcesses(actionAgent("child", cwd, [321]), "SIGCONT", "SIGCONT", processes, handledPids),
    ]);

    expect(results).toHaveLength(2);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(321, "SIGCONT");
  });
});

describe("child process safety", () => {
  it("applies a conservative timeout to commands run through the shared child-process boundary", async () => {
    const execute = vi.fn(async (_command: string, _args: readonly string[], _options: ExecFileOptions) => ({
      stdout: "ok\n",
    }));

    await run("ps", ["-Ao", "comm="], {}, execute);

    expect(execute.mock.calls[0]?.[2]).toMatchObject({ maxBuffer: MAX_BUFFER, timeout: 5_000 });
  });

  it("clears snapshotInFlight after a timeout so the next caller can retry", async () => {
    const timeout = Object.assign(new Error("snapshot timed out"), { code: "ETIMEDOUT" });
    const buildSnapshot = vi.fn(async () => {
      throw timeout;
    });

    await expect(getSnapshot(buildSnapshot)).rejects.toBe(timeout);
    await expect(getSnapshot(buildSnapshot)).rejects.toBe(timeout);

    expect(buildSnapshot).toHaveBeenCalledTimes(2);
  });

  it("disables GitHub CLI prompts", async () => {
    const execute = vi.fn(async (_command: string, _args: readonly string[], _options: ExecFileOptions) => ({
      stdout: "https://example.test/pr/1\n",
    }));

    await run("gh", ["pr", "create", "--fill"], {}, execute);

    const ghOptions = execute.mock.calls[0]?.[2];
    expect(ghOptions).toMatchObject({ timeout: 5_000 });
    expect(ghOptions?.env?.GH_PROMPT_DISABLED).toBe("1");
  });
});

describe("view_diff", () => {
  it("reports staged and untracked changes as well as unstaged changes", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "codex-diff-cwd-"));
    cleanups.push(() => rm(cwd, { force: true, recursive: true }));
    const runCommand = vi.fn(async (_command: string, args: string[]) =>
      args.includes("status") ? " M unstaged.ts\nM  staged.ts\n?? untracked.ts\n" : " unstaged.ts | 1 +\n",
    );

    const outcome = await ACTION_HANDLERS.view_diff({
      agent: actionAgent("root", cwd, []),
      force: false,
      handledPids: undefined,
      runCommand,
    });

    expect(outcome.message).toContain("unstaged.ts");
    expect(outcome.message).toContain("staged.ts");
    expect(outcome.message).toContain("untracked.ts");
    expect(outcome.message).toBe(" M unstaged.ts\nM  staged.ts\n?? untracked.ts");
  });
});

/** Mirrors readThreadsAndEdges' PRAGMA-derived column sets, then drives the exported buildStateQuery. */
async function columnsOf(databasePath: string, table: string): Promise<Set<string>> {
  const names = new Set<string>();
  for (const row of await queryJson(databasePath, `PRAGMA table_info(${table})`)) {
    if (typeof row.name === "string") {
      names.add(row.name);
    }
  }
  return names;
}

async function runStateQuery(
  databasePath: string,
  workspaceLimits: Map<string, number>,
): Promise<{ threads: Record<string, unknown>[]; edges: Record<string, unknown>[] }> {
  const threadColumns = await columnsOf(databasePath, "threads");
  const edgeColumns = await columnsOf(databasePath, "thread_spawn_edges");
  const records = await queryJson(databasePath, buildStateQuery(threadColumns, edgeColumns, workspaceLimits, now));
  return {
    threads: records.filter((record) => record.record_type === "thread"),
    edges: records.filter((record) => record.record_type === "edge"),
  };
}

describe("classifyNode", () => {
  it("prefers a completion signal over a live workspace runtime", () => {
    expect(
      classifyNode({
        activity: { kind: "completed", text: "", timestamp: now - 500 },
        edgeStatus: "open",
        hasWorkspaceRuntime: true,
        isRoot: false,
        now,
      }),
    ).toBe("completed");
  });

  it("treats a closed child edge as completed even with recent activity and a shared-directory process", () => {
    expect(
      classifyNode({
        activity: { kind: "event", text: "", timestamp: now - 500 },
        edgeStatus: "closed",
        hasWorkspaceRuntime: true,
        isRoot: false,
        now,
      }),
    ).toBe("completed");
  });

  it("is working when the latest activity is within the recent-activity window", () => {
    expect(
      classifyNode({
        activity: { kind: "message", text: "", timestamp: now - 60_000 },
        edgeStatus: null,
        hasWorkspaceRuntime: false,
        isRoot: false,
        now,
      }),
    ).toBe("working");
  });

  it("is observed for a root with a live workspace runtime but no recent activity", () => {
    expect(
      classifyNode({
        activity: { kind: "event", text: "", timestamp: now - 10 * 60_000 },
        edgeStatus: null,
        hasWorkspaceRuntime: true,
        isRoot: true,
        now,
      }),
    ).toBe("observed");
  });

  it("is waiting for an open edge with no recent activity and no root runtime", () => {
    expect(
      classifyNode({
        activity: { kind: "event", text: "", timestamp: now - 10 * 60_000 },
        edgeStatus: "open",
        hasWorkspaceRuntime: false,
        isRoot: false,
        now,
      }),
    ).toBe("waiting");
  });

  it("is stale once activity is older than the idle threshold with nothing keeping it alive", () => {
    expect(
      classifyNode({
        activity: { kind: "event", text: "", timestamp: now - (STALE_HEARTBEAT_THRESHOLD_MS + 60_000) },
        edgeStatus: null,
        hasWorkspaceRuntime: false,
        isRoot: false,
        now,
      }),
    ).toBe("stale");
  });

  it("is unknown when there is no activity timestamp and nothing else to classify on", () => {
    expect(
      classifyNode({
        activity: { kind: "unknown", text: "", timestamp: null },
        edgeStatus: null,
        hasWorkspaceRuntime: false,
        isRoot: false,
        now,
      }),
    ).toBe("unknown");
  });

  it("treats an explicit rollout error as failed evidence", () => {
    expect(
      classifyNode({
        activity: { kind: "failed", text: "sandbox denied", timestamp: now - 500 },
        edgeStatus: "open",
        hasWorkspaceRuntime: true,
        isRoot: false,
        now,
      }),
    ).toBe("failed");
  });
});

describe("describeRolloutEvent", () => {
  it("reads a sub-agent activity event as a recent work signal", () => {
    expect(
      describeRolloutEvent({
        timestamp: "2026-07-10T00:42:35.788Z",
        type: "event_msg",
        payload: { type: "sub_agent_activity", kind: "interacted", occurred_at_ms: now - 500 },
      }),
    ).toEqual({ kind: "event", text: "하위 에이전트 최근 활동", timestamp: now - 500 });
  });

  it("recognizes a task_complete event as a completion signal", () => {
    expect(
      describeRolloutEvent({
        timestamp: now - 500,
        type: "event_msg",
        payload: { type: "task_complete" },
      }),
    ).toEqual({ kind: "completed", text: "작업 완료 신호", timestamp: now - 500 });
  });

  it("recognizes the newer task_started event as running activity", () => {
    expect(
      describeRolloutEvent({
        timestamp: now - 500,
        type: "event_msg",
        payload: { type: "task_started" },
      }),
    ).toEqual({ kind: "running", text: "작업 시작 신호", timestamp: now - 500 });
  });

  it("recognizes event_msg/error as failed evidence", () => {
    expect(
      describeRolloutEvent({
        timestamp: now - 500,
        type: "event_msg",
        payload: { type: "error", message: "sandbox denied" },
      }),
    ).toEqual({ kind: "failed", text: "sandbox denied", timestamp: now - 500 });
  });

  it("turns numeric timestamps outside the JavaScript Date range into null", () => {
    expect(
      describeRolloutEvent({
        timestamp: Number.MAX_VALUE,
        type: "event_msg",
        payload: { type: "agent_message", message: "still parseable" },
      })?.timestamp,
    ).toBeNull();
  });
});

describe("state database discovery", () => {
  it("skips a vanished candidate when another valid state database exists", async () => {
    const databasePath = await createDatabase(`
      CREATE TABLE threads (id TEXT, updated_at INTEGER, cwd TEXT);
      CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT, status TEXT);
      INSERT INTO threads VALUES ('valid-root', ${Date.now()}, '/workspace/valid');
    `);
    const codexHome = path.dirname(databasePath);
    await symlink(path.join(codexHome, "already-gone.sqlite"), path.join(codexHome, "state_vanished.sqlite"));
    vi.stubEnv("CODEX_HOME", codexHome);
    const claudeHome = await mkdtemp(path.join(tmpdir(), "claude-session-monitor-"));
    cleanups.push(() => rm(claudeHome, { force: true, recursive: true }));
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeHome);

    const snapshot = await localDashboardRepository.getSnapshot();

    expect(snapshot.allIds).toContain("valid-root");
  });

  it("rejects a negative cache age after the wall clock moves backward", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "codex-session-monitor-empty-"));
    const claudeHome = await mkdtemp(path.join(tmpdir(), "claude-session-monitor-empty-"));
    cleanups.push(() => rm(codexHome, { force: true, recursive: true }));
    cleanups.push(() => rm(claudeHome, { force: true, recursive: true }));
    vi.stubEnv("CODEX_HOME", codexHome);
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeHome);
    vi.resetModules();
    const { localDashboardRepository: freshRepository } = await import("./local-adapter");
    const clock = vi.spyOn(Date, "now").mockReturnValue(2_000);
    const first = await freshRepository.getSnapshot();
    clock.mockReturnValue(1_500);

    const second = await freshRepository.getSnapshot();

    expect(second).not.toBe(first);
  });

  it("skips 257-character thread and edge ids so the snapshot remains schema-valid", async () => {
    const invalidId = "x".repeat(257);
    const databasePath = await createDatabase(`
      CREATE TABLE threads (id TEXT, updated_at INTEGER, cwd TEXT);
      CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT, status TEXT);
      INSERT INTO threads VALUES ('${invalidId}', ${Date.now()}, '/workspace/invalid-id');
      INSERT INTO threads VALUES ('valid-child', ${Date.now()}, '/workspace/invalid-id');
      INSERT INTO thread_spawn_edges VALUES ('${invalidId}', 'valid-child', 'open');
    `);
    vi.stubEnv("CODEX_HOME", path.dirname(databasePath));
    const claudeHome = await mkdtemp(path.join(tmpdir(), "claude-invalid-id-"));
    cleanups.push(() => rm(claudeHome, { force: true, recursive: true }));
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeHome);
    vi.resetModules();
    const { localDashboardRepository: freshRepository } = await import("./local-adapter");

    const snapshot = await freshRepository.getSnapshot();

    expect(snapshot.allIds).toEqual(["valid-child"]);
    expect(snapshot.byId["valid-child"]?.parentId).toBeNull();
    expect(DashboardSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });
});

describe("readTail", () => {
  it("preserves a complete first record when the tail starts exactly after a newline", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codex-tail-"));
    cleanups.push(() => rm(directory, { force: true, recursive: true }));
    const filePath = path.join(directory, "rollout.jsonl");
    const completeTail = '{"type":"event_msg","payload":{"type":"task_complete"}}\n';
    await writeFile(filePath, `discarded\n${completeTail}`, "utf8");

    const tail = await readTail(filePath, Buffer.byteLength(completeTail));

    expect(tail).toBe(completeTail);
  });

  it("lets snapshot activity enrichment degrade when a rollout file vanishes", async () => {
    const missing = {
      ...thread({ id: "missing", cwd: "/workspace/missing", updatedAt: now }),
      rolloutPath: path.join(tmpdir(), "definitely-missing-activity.jsonl"),
    };

    const activities = await collectLatestActivities(new Map([[missing.id, missing]]), new Set([missing.id]));

    expect(activities.size).toBe(0);
  });

  it("returns an empty tail when a partial leading record contains no newline", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codex-tail-partial-"));
    cleanups.push(() => rm(directory, { force: true, recursive: true }));
    const filePath = path.join(directory, "rollout.jsonl");
    await writeFile(filePath, "discarded-partial-record", "utf8");

    const tail = await readTail(filePath, Buffer.byteLength("record"));

    expect(tail).toBe("");
  });

  it("rejects a leaf symlink instead of following it outside the accepted transcript", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codex-tail-symlink-"));
    cleanups.push(() => rm(directory, { force: true, recursive: true }));
    const targetPath = path.join(directory, "outside.jsonl");
    const linkPath = path.join(directory, "rollout.jsonl");
    await writeFile(targetPath, "sensitive\n", "utf8");
    await symlink(targetPath, linkPath);

    const read = readTail(linkPath);

    await expect(read).rejects.toMatchObject({ code: "ELOOP" });
  });

  it("rejects a FIFO without blocking on transcript input", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codex-tail-fifo-"));
    cleanups.push(() => rm(directory, { force: true, recursive: true }));
    const fifoPath = path.join(directory, "rollout.fifo");
    await execFileAsync("mkfifo", [fifoPath]);
    const keeper = await openFile(fifoPath, constants.O_RDWR | constants.O_NONBLOCK);

    try {
      await expect(readTail(fifoPath)).rejects.toMatchObject({ code: "EINVAL" });
    } finally {
      await keeper.close();
    }
  });
});

describe("Claude cost aggregation", () => {
  it("returns null when any Claude agent cost is unknown while ignoring intentional Codex nulls", () => {
    const codex = actionAgent("codex", "/workspace/codex", []);
    const knownClaude: Agent = {
      ...actionAgent("claude-known", "/workspace/claude-known", []),
      source: "claude_code",
      costUsd: 2.5,
    };
    const unknownClaude: Agent = {
      ...actionAgent("claude-unknown", "/workspace/claude-unknown", []),
      source: "claude_code",
      costUsd: null,
    };

    const merged = mergeClaudeContent(contentWithAgent(codex), [knownClaude, unknownClaude], [], now);

    expect(merged.summary.sessionCostUsd).toBeNull();
  });

  it("sums Claude costs when every Claude agent is priced", () => {
    const codex = actionAgent("codex", "/workspace/codex", []);
    const claude: Agent[] = [1.25, 2.5].map((costUsd, index) => ({
      ...actionAgent(`claude-${index}`, `/workspace/claude-${index}`, []),
      source: "claude_code",
      costUsd,
    }));

    const merged = mergeClaudeContent(contentWithAgent(codex), claude, [], now);

    expect(merged.summary.sessionCostUsd).toBe(3.75);
  });
});

describe("activityCandidatesFromTail + selectLatestActivities", () => {
  it("routes a parent rollout's sub-agent signal to the target child thread", () => {
    const candidates = activityCandidatesFromTail(
      [
        JSON.stringify({
          timestamp: now - 2_000,
          type: "event_msg",
          payload: { type: "agent_message", message: "메인 에이전트가 확인했습니다." },
        }),
        JSON.stringify({
          timestamp: now - 1_000,
          type: "event_msg",
          payload: {
            type: "sub_agent_activity",
            agent_thread_id: "child-thread",
            kind: "started",
            occurred_at_ms: now - 500,
          },
        }),
      ].join("\n"),
      "parent-thread",
    );

    const activities = selectLatestActivities(candidates, new Set(["parent-thread", "child-thread"]));

    expect(activities.get("parent-thread")?.text).toBe("메인 에이전트가 확인했습니다.");
    expect(activities.get("child-thread")?.text).toBe("하위 에이전트 작업 시작");
    expect(activities.get("child-thread")?.timestamp).toBe(now - 500);
  });
});

describe("selectRootThreads", () => {
  it("picks the live workspace's main session and excludes children and idle workspaces", () => {
    const threads = [
      thread({ id: "root-live", cwd: "/workspace/live", title: "메인 작업", updatedAt: now - 1_000 }),
      thread({ id: "child-live", cwd: "/workspace/live", agentNickname: "분석 담당", updatedAt: now - 500 }),
      thread({ id: "root-old", cwd: "/workspace/old", title: "오래된 작업", updatedAt: now - 86_400_000 }),
    ];
    const edges = [edge("root-live", "child-live", "open")];
    const processes = [codexProcess(41, "/workspace/live")];

    const roots = selectRootThreads(threads, edges, processes, now);
    expect(roots.map((root) => root.id)).toEqual(["root-live"]);
  });

  it("shows no more past sessions in a directory than there are live processes", () => {
    const threads = [
      thread({ id: "latest", cwd: "/workspace/live", updatedAt: now - 100 }),
      thread({ id: "older", cwd: "/workspace/live", updatedAt: now - 1_000 }),
      thread({ id: "oldest", cwd: "/workspace/live", updatedAt: now - 10_000 }),
    ];
    const processes = [codexProcess(10, "/workspace/live"), codexProcess(11, "/workspace/live")];

    const roots = selectRootThreads(threads, [], processes, now);
    expect(roots.map((root) => root.id)).toEqual(["latest", "older"]);
  });

  it("does not hide a live child whose edge points at a vanished (archived) parent", () => {
    const threads = [thread({ id: "orphan-child", cwd: "/workspace/live", updatedAt: now - 1_000 })];
    const edges = [edge("archived-parent", "orphan-child", "closed")];
    const processes = [codexProcess(41, "/workspace/live")];

    const roots = selectRootThreads(threads, edges, processes, now);
    expect(roots.map((root) => root.id)).toEqual(["orphan-child"]);
  });
});

describe("buildStateQuery (against a real sqlite state DB)", () => {
  it("reads the current schema, keeping the edge status", async () => {
    const databasePath = await createDatabase(`
      CREATE TABLE threads (
        id TEXT, rollout_path TEXT, updated_at INTEGER, cwd TEXT, title TEXT,
        tokens_used INTEGER, agent_nickname TEXT, agent_role TEXT, model TEXT, archived INTEGER
      );
      CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT, status TEXT);
      INSERT INTO threads VALUES ('root', '/tmp/root.jsonl', ${now}, '/workspace/live', '메인', 10, '메인', 'main', 'gpt-5', 0);
      INSERT INTO threads VALUES ('child', '/tmp/child.jsonl', ${now}, '/workspace/live', '하위', 5, '하위', 'subagent', 'gpt-5', 0);
      INSERT INTO thread_spawn_edges VALUES ('root', 'child', 'closed');
    `);

    const { threads, edges } = await runStateQuery(databasePath, new Map());

    expect(threads.map((record) => record.id).sort()).toEqual(["child", "root"]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ parent_thread_id: "root", child_thread_id: "child", edge_status: "closed" });
  });

  it("reads a minimal schema with no status column, defaulting edge status to null", async () => {
    const databasePath = await createDatabase(`
      CREATE TABLE threads (id TEXT, updated_at INTEGER, cwd TEXT);
      CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT);
      INSERT INTO threads VALUES ('root', ${now}, '/workspace/live');
      INSERT INTO threads VALUES ('child', ${now}, '/workspace/live');
      INSERT INTO thread_spawn_edges VALUES ('root', 'child');
    `);

    const { threads, edges } = await runStateQuery(databasePath, new Map());

    expect(threads.map((record) => record.id).sort()).toEqual(["child", "root"]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ parent_thread_id: "root", child_thread_id: "child", edge_status: null });
  });

  it("reads only the live workspace and its subtree, not the thousands of old sessions elsewhere", async () => {
    const databasePath = await createDatabase(`
      CREATE TABLE threads (
        id TEXT, rollout_path TEXT, updated_at INTEGER, cwd TEXT, title TEXT,
        tokens_used INTEGER, agent_nickname TEXT, agent_role TEXT, model TEXT, archived INTEGER
      );
      CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT, status TEXT);
      INSERT INTO threads VALUES ('live-root', NULL, ${now}, '/workspace/current', '현재 메인', 0, NULL, NULL, NULL, 0);
      INSERT INTO threads VALUES ('live-child', NULL, ${now}, '/workspace/current', '현재 하위', 0, NULL, NULL, NULL, 0);
      INSERT INTO thread_spawn_edges VALUES ('live-root', 'live-child', 'open');
      WITH RECURSIVE number(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM number WHERE value < 1500
      )
      INSERT INTO threads
      SELECT printf('old-%04d', value), NULL, ${now - 86_400_000}, '/workspace/old', '과거 세션', 0, NULL, NULL, NULL, 0
      FROM number;
    `);

    const { threads, edges } = await runStateQuery(databasePath, new Map([["/workspace/current", 1]]));

    expect(threads.map((record) => record.id).sort()).toEqual(["live-child", "live-root"]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ parent_thread_id: "live-root", child_thread_id: "live-child", edge_status: "open" });
  });

  it("falls back to the most recent second-precision roots when no process is running", async () => {
    const databasePath = await createDatabase(`
      CREATE TABLE threads (id TEXT, updated_at INTEGER, cwd TEXT, archived INTEGER);
      CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT, status TEXT);
      INSERT INTO threads VALUES ('recent-root', ${Math.floor((now - 1_000) / 1000)}, '/workspace/recent', 0);
      INSERT INTO threads VALUES ('recent-child', ${Math.floor((now - 500) / 1000)}, '/workspace/recent', 0);
      INSERT INTO thread_spawn_edges VALUES ('recent-root', 'recent-child', 'open');
    `);

    const { threads } = await runStateQuery(databasePath, new Map());

    expect(threads.map((record) => record.id).sort()).toEqual(["recent-child", "recent-root"]);
  });

  it("truncates a huge selected text field in SQL before sqlite3 reaches maxBuffer", async () => {
    const databasePath = await createDatabase(`
      CREATE TABLE threads (id TEXT, updated_at INTEGER, cwd TEXT, first_user_message TEXT);
      CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT, status TEXT);
      INSERT INTO threads VALUES ('huge-root', ${now}, '/workspace/huge', printf('%.*c', 9000000, 'x'));
    `);

    const { threads } = await runStateQuery(databasePath, new Map());

    expect(threads[0]?.first_user_message).toHaveLength(4_096);
  });

  it("truncates a huge selected edge field before sqlite3 reaches maxBuffer", async () => {
    const databasePath = await createDatabase(`
      CREATE TABLE threads (id TEXT, updated_at INTEGER, cwd TEXT);
      CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT, status TEXT);
      INSERT INTO threads VALUES ('root', ${now}, '/workspace/huge-edge');
      INSERT INTO threads VALUES ('child', ${now}, '/workspace/huge-edge');
      INSERT INTO thread_spawn_edges VALUES ('root', 'child', printf('%.*c', 9000000, 'x'));
    `);

    const { edges } = await runStateQuery(databasePath, new Map([["/workspace/huge-edge", 1]]));

    expect(edges[0]?.edge_status).toHaveLength(4_096);
  });

  it("bounds oversized TEXT stored in every numeric thread column before sqlite3 reaches maxBuffer", async () => {
    const databasePath = await createDatabase(`
      CREATE TABLE threads (id TEXT, created_at TEXT, updated_at TEXT, cwd TEXT, tokens_used TEXT);
      CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT, status TEXT);
      INSERT INTO threads VALUES (
        'huge-numeric-root',
        printf('%.*c', 3000000, '7'),
        printf('%.*c', 3000000, '7'),
        '/workspace/huge-numeric',
        printf('%.*c', 3000000, '7')
      );
    `);

    const { threads } = await runStateQuery(databasePath, new Map([["/workspace/huge-numeric", 1]]));

    expect(threads[0]?.created_at).toHaveLength(4_096);
    expect(threads[0]?.updated_at).toHaveLength(4_096);
    expect(threads[0]?.tokens_used).toHaveLength(4_096);
  });
});
