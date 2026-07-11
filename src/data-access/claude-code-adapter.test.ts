import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentSchema } from "@/domain/agent/agent";

import {
  classifyClaudeStatus,
  collectClaudeCodeAgents,
  pickDisplayName,
  sessionCostUsd,
  totalTokens,
} from "./claude-code-adapter";
import { ratesForModel } from "./claude-pricing";
import { STALE_HEARTBEAT_THRESHOLD_MS } from "./incident-detection";

const NOW = Date.parse("2026-07-11T12:00:00.000Z");
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
const MAX_SESSION_INDEX_BYTES = 8 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const fixtureHomes = new Set<string>();

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all([...fixtureHomes].map((home) => rm(home, { recursive: true, force: true })));
  fixtureHomes.clear();
});

async function fixtureHome(): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "claude-reader-"));
  fixtureHomes.add(home);
  vi.stubEnv("CLAUDE_CONFIG_DIR", home);
  return home;
}

async function fixtureProject(): Promise<{ home: string; projectDir: string }> {
  const home = await fixtureHome();
  const projectDir = path.join(home, "projects", "fixture-project");
  await mkdir(projectDir, { recursive: true });
  return { home, projectDir };
}

function userLine(cwd: string, text = "fixture prompt"): string {
  return JSON.stringify({ type: "user", timestamp: new Date(NOW).toISOString(), cwd, message: { content: text } });
}

async function writeSession(projectDir: string, sessionId: string, lines: readonly string[]): Promise<string> {
  const filePath = path.join(projectDir, `${sessionId}.jsonl`);
  await writeFile(filePath, lines.join("\n"));
  await utimes(filePath, new Date(NOW), new Date(NOW));
  return filePath;
}

/** Shape mirrors the adapter's internal ResponseUsage — one deduped Claude API response. */
function usage(overrides: {
  model: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  ephemeral5mTokens?: number;
  ephemeral1hTokens?: number;
}) {
  return {
    model: overrides.model,
    inputTokens: overrides.inputTokens ?? 0,
    outputTokens: overrides.outputTokens ?? 0,
    cacheCreationTokens: overrides.cacheCreationTokens ?? 0,
    cacheReadTokens: overrides.cacheReadTokens ?? 0,
    ephemeral5mTokens: overrides.ephemeral5mTokens ?? 0,
    ephemeral1hTokens: overrides.ephemeral1hTokens ?? 0,
  };
}

describe("ratesForModel", () => {
  it.each([
    ["claude-fable-5", { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1, output: 50 }],
    ["claude-sonnet-4-6", { input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15 }],
    ["claude-haiku-4-5", { input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5 }],
    ["claude-haiku-4-5-20251001", { input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5 }],
  ])("returns the sourced rates for %s", (model, expected) => {
    expect(ratesForModel(model)).toEqual(expected);
  });
});

describe("sessionCostUsd", () => {
  it("computes a real cost for a single sonnet-5 response against the sourced rates", () => {
    // 1M input ($2) + 1M output ($10) = $12; nothing cached.
    const cost = sessionCostUsd([usage({ model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 1_000_000 })]);
    expect(cost).toBe(12);
  });

  it("applies every rate line (base/5m-write/1h-write/cache-read/output) for opus-4-8", () => {
    // input 1M×$5 + 5m 1M×$6.25 + 1h 1M×$10 + read 1M×$0.50 + output 1M×$25 = $46.75.
    const cost = sessionCostUsd([
      usage({
        model: "claude-opus-4-8",
        inputTokens: 1_000_000,
        cacheCreationTokens: 2_000_000,
        ephemeral5mTokens: 1_000_000,
        ephemeral1hTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ]);
    expect(cost).toBe(46.75);
  });

  it("returns null when cache-creation tokens have no complete matching TTL breakdown", () => {
    const cost = sessionCostUsd([
      usage({ model: "claude-sonnet-5", cacheCreationTokens: 1_000_000, ephemeral5mTokens: 400_000 }),
    ]);
    expect(cost).toBeNull();
  });

  it("returns null when a TTL breakdown has no matching aggregate cache-creation count", () => {
    const cost = sessionCostUsd([usage({ model: "claude-sonnet-5", ephemeral5mTokens: 400_000 })]);
    expect(cost).toBeNull();
  });

  it("sums across multiple known-model responses", () => {
    const cost = sessionCostUsd([
      usage({ model: "claude-sonnet-5", outputTokens: 500_000 }), // $5
      usage({ model: "claude-opus-4-8", outputTokens: 200_000 }), // $5
    ]);
    expect(cost).toBe(10);
  });

  it("computes an exact cost for a mixed fable-5 and dated haiku-4-5 session", () => {
    const cost = sessionCostUsd([
      usage({
        model: "claude-fable-5",
        inputTokens: 100_000,
        outputTokens: 100_000,
        cacheCreationTokens: 200_000,
        cacheReadTokens: 100_000,
        ephemeral5mTokens: 100_000,
        ephemeral1hTokens: 100_000,
      }),
      usage({
        model: "claude-haiku-4-5-20251001",
        inputTokens: 100_000,
        outputTokens: 100_000,
        cacheCreationTokens: 200_000,
        cacheReadTokens: 100_000,
        ephemeral5mTokens: 100_000,
        ephemeral1hTokens: 100_000,
      }),
    ]);
    expect(cost).toBe(10.285);
  });

  it("returns null when any response used an unpriced model that actually billed tokens", () => {
    const cost = sessionCostUsd([
      usage({ model: "claude-opus-4-8", outputTokens: 1_000_000 }),
      usage({ model: "claude-unpriced-test-model", inputTokens: 50_000 }),
    ]);
    expect(cost).toBeNull();
  });

  it("does not go null for a zero-token unpriced response (e.g. <synthetic>)", () => {
    const cost = sessionCostUsd([
      usage({ model: "claude-sonnet-5", outputTokens: 100_000 }), // $1
      usage({ model: "<synthetic>" }), // 0 tokens ⇒ ignored, not fatal
    ]);
    expect(cost).toBe(1);
  });

  it("is $0 for a session with no assistant responses yet", () => {
    expect(sessionCostUsd([])).toBe(0);
  });

  it("returns null for an unsafe counter or a safe-counter aggregate overflow", () => {
    const unsafe = usage({ model: "claude-sonnet-5", inputTokens: Number.MAX_VALUE });
    const largestSafe = usage({ model: "claude-sonnet-5", inputTokens: Number.MAX_SAFE_INTEGER });
    expect(sessionCostUsd([unsafe])).toBeNull();
    expect(sessionCostUsd([largestSafe, largestSafe])).toBeNull();
  });
});

describe("totalTokens", () => {
  it("sums the four raw usage counters across responses", () => {
    const total = totalTokens([
      usage({
        model: "claude-opus-4-8",
        inputTokens: 10,
        outputTokens: 20,
        cacheCreationTokens: 30,
        cacheReadTokens: 40,
      }),
      usage({ model: "claude-sonnet-5", inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4 }),
    ]);
    expect(total).toBe(110);
  });

  it("counts tokens even for unpriced models (token count is model-agnostic)", () => {
    expect(totalTokens([usage({ model: "claude-unpriced-test-model", inputTokens: 500 })])).toBe(500);
  });

  it("returns null for an unsafe counter or a safe-counter aggregate overflow", () => {
    const unsafe = usage({ model: "claude-sonnet-5", inputTokens: Number.MAX_VALUE });
    const largestSafe = usage({ model: "claude-sonnet-5", inputTokens: Number.MAX_SAFE_INTEGER });
    expect(totalTokens([unsafe])).toBeNull();
    expect(totalTokens([largestSafe, largestSafe])).toBeNull();
  });
});

describe("pickDisplayName", () => {
  it("prefers the ai-title when present", () => {
    expect(pickDisplayName("멀티 에이전트 대시보드 마이그레이션", "raw first prompt text", false)).toBe(
      "멀티 에이전트 대시보드 마이그레이션",
    );
  });

  it("falls back to the first user prompt when there is no ai-title", () => {
    expect(pickDisplayName(null, "테스트를 추가해 주세요", false)).toBe("테스트를 추가해 주세요");
  });

  it("collapses whitespace and truncates a very long title", () => {
    const long = "제목 ".repeat(200);
    const name = pickDisplayName(long, null, false);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith("…")).toBe(true);
  });

  it("uses a role-appropriate placeholder when nothing is available", () => {
    expect(pickDisplayName(null, null, false)).toBe("이름 없는 메인 세션");
    expect(pickDisplayName(null, null, true)).toBe("이름 없는 서브 에이전트");
  });
});

describe("classifyClaudeStatus", () => {
  const now = Date.parse("2026-07-10T12:00:00.000Z");

  it("is running within the recent-activity window", () => {
    const status = classifyClaudeStatus(now - 60_000, now);
    expect(status.kind).toBe("running");
  });

  it("is waiting past recent activity but within the idle threshold", () => {
    const status = classifyClaudeStatus(now - 10 * 60_000, now);
    expect(status.kind).toBe("waiting");
  });

  it("is stale past the shared idle threshold", () => {
    const status = classifyClaudeStatus(now - (STALE_HEARTBEAT_THRESHOLD_MS + 60_000), now);
    expect(status.kind).toBe("stale");
    if (status.kind === "stale") {
      expect(Date.parse(status.lastHeartbeatAt)).toBe(now - (STALE_HEARTBEAT_THRESHOLD_MS + 60_000));
    }
  });
});

describe("collectClaudeCodeAgents", () => {
  it("keeps a missing Claude projects tree clean", async () => {
    await fixtureHome();
    expect(await collectClaudeCodeAgents(NOW)).toEqual({ agents: [], warnings: [] });
  });

  it("warns when the projects root exists but cannot be read as a directory", async () => {
    const home = await fixtureHome();
    await writeFile(path.join(home, "projects"), "not a directory");

    const result = await collectClaudeCodeAgents(NOW);

    expect(result.agents).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it.skipIf(process.platform === "win32")("warns when a project directory cannot be read", async () => {
    const { projectDir } = await fixtureProject();
    await chmod(projectDir, 0);
    const result = await collectClaudeCodeAgents(NOW).finally(() => chmod(projectDir, 0o700));
    expect(result.warnings).toHaveLength(1);
  });

  it("ignores a transcript symlink that escapes the canonical project directory", async () => {
    const { home, projectDir } = await fixtureProject();
    const outside = path.join(home, "outside.jsonl");
    await writeFile(outside, userLine(home, "outside secret"));
    await utimes(outside, new Date(NOW), new Date(NOW));
    await symlink(outside, path.join(projectDir, "escaped.jsonl"));

    const result = await collectClaudeCodeAgents(NOW);

    expect(result.agents).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "does not open non-regular transcripts and emits one aggregate warning",
    async () => {
      const { home, projectDir } = await fixtureProject();
      const outside = path.join(home, "outside.jsonl");
      await writeFile(outside, userLine(home, "outside secret"));
      await symlink(outside, path.join(projectDir, "escaped.jsonl"));
      const fifoPath = path.join(projectDir, "pipe.jsonl");
      await execFileAsync("mkfifo", [fifoPath]);
      await utimes(fifoPath, new Date(NOW), new Date(NOW));

      const collection = collectClaudeCodeAgents(NOW);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        collection,
        new Promise<"timed out">((resolve) => {
          timeout = setTimeout(() => resolve("timed out"), 250);
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      if (outcome === "timed out") await Promise.all([writeFile(fifoPath, ""), collection]);

      expect(outcome).not.toBe("timed out");
      if (outcome !== "timed out") {
        expect(outcome.agents).toEqual([]);
        expect(outcome.warnings.filter((warning) => warning.includes("일반 파일"))).toEqual([
          expect.stringContaining("2개"),
        ]);
      }
    },
  );

  it("skips an oversized transcript instead of reporting partial tokens or cost", async () => {
    const { projectDir } = await fixtureProject();
    const assistant = JSON.stringify({
      type: "assistant",
      timestamp: new Date(NOW).toISOString(),
      cwd: projectDir,
      message: {
        id: "message-1",
        model: "claude-sonnet-5",
        usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
        content: [{ type: "text", text: "partial data" }],
      },
    });
    const filePath = await writeSession(projectDir, "oversized", [assistant, ""]);
    await truncate(filePath, MAX_TRANSCRIPT_BYTES + 1);
    await utimes(filePath, new Date(NOW), new Date(NOW));

    const result = await collectClaudeCodeAgents(NOW);

    expect(result.agents).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("크기 제한"))).toBe(true);
  });

  it("skips an oversized sessions index with one honest warning", async () => {
    const { projectDir } = await fixtureProject();
    await writeSession(projectDir, "session-1", [userLine(projectDir)]);
    const indexPath = path.join(projectDir, "sessions-index.json");
    await writeFile(indexPath, "");
    await truncate(indexPath, MAX_SESSION_INDEX_BYTES + 1);

    const result = await collectClaudeCodeAgents(NOW);

    expect(result.agents).toHaveLength(1);
    expect(result.warnings.filter((warning) => warning.includes("인덱스"))).toHaveLength(1);
  });

  it("promise-caches one malformed sessions-index read across concurrent scans", async () => {
    const { projectDir } = await fixtureProject();
    await Promise.all(
      ["one", "two", "three", "four"].map((id) => writeSession(projectDir, id, [userLine(projectDir, id)])),
    );
    await writeFile(path.join(projectDir, "sessions-index.json"), "{truncated");

    const result = await collectClaudeCodeAgents(NOW);

    expect(result.agents).toHaveLength(4);
    expect(result.warnings.filter((warning) => warning.includes("인덱스"))).toHaveLength(1);
  });

  it("parses indented JSON lines while still skipping malformed records", async () => {
    const { projectDir } = await fixtureProject();
    await writeSession(projectDir, "indented", ["  {truncated", `  ${userLine(projectDir, "indented prompt")}`]);

    const result = await collectClaudeCodeAgents(NOW);

    expect(result.agents[0]?.currentTask).toBe("indented prompt");
  });

  it("namespaces the public agent id while retaining the raw session id for discovery", async () => {
    const { projectDir } = await fixtureProject();
    await writeSession(projectDir, "shared-id", [userLine(projectDir)]);

    const result = await collectClaudeCodeAgents(NOW);

    expect(result.agents[0]?.id).toBe("claude_code:shared-id");
  });

  it("accepts a 244-character raw id, rejects 245, and returns only schema-valid agents", async () => {
    const { projectDir } = await fixtureProject();
    const validRawId = "a".repeat(244);
    await writeSession(projectDir, validRawId, [userLine(projectDir)]);
    await writeSession(projectDir, "b".repeat(245), [userLine(projectDir)]);

    const result = await collectClaudeCodeAgents(NOW);

    expect(result.agents.map((agent) => agent.id)).toEqual([`claude_code:${validRawId}`]);
    for (const agent of result.agents) AgentSchema.parse(agent);
    expect(result.warnings.filter((warning) => warning.includes("ID 길이"))).toEqual([expect.stringContaining("1개")]);
  });

  it("skips unsafe transcript counters with one bounded warning", async () => {
    const { projectDir } = await fixtureProject();
    const assistant = JSON.stringify({
      type: "assistant",
      timestamp: new Date(NOW).toISOString(),
      cwd: projectDir,
      message: {
        id: "unsafe-usage",
        model: "claude-sonnet-5",
        usage: { input_tokens: Number.MAX_VALUE },
        content: [{ type: "text", text: "unsafe" }],
      },
    });
    await writeSession(projectDir, "unsafe-usage", [assistant]);

    const result = await collectClaudeCodeAgents(NOW);

    expect(result.agents).toEqual([]);
    expect(result.warnings.filter((warning) => warning.includes("토큰"))).toHaveLength(1);
  });
});
