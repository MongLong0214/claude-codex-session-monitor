import { describe, expect, it } from "vitest";
import type { AgentStatus } from "@/domain/agent/status";
import {
  EMPTY_VALUE,
  formatCost,
  formatElapsed,
  formatTokens,
  retryCount,
  shortCommitSha,
  statusReason,
  statusTimestamp,
} from "./format";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

function isoMinus(milliseconds: number): string {
  return new Date(NOW - milliseconds).toISOString();
}

describe("formatElapsed", () => {
  it("renders seconds below one minute", () => {
    expect(formatElapsed(isoMinus(0), NOW)).toBe("0s");
    expect(formatElapsed(isoMinus(12_000), NOW)).toBe("12s");
    expect(formatElapsed(isoMinus(59_999), NOW)).toBe("59s");
  });

  it("renders whole minutes below one hour", () => {
    expect(formatElapsed(isoMinus(60_000), NOW)).toBe("1m");
    expect(formatElapsed(isoMinus(59 * 60_000 + 59_000), NOW)).toBe("59m");
  });

  it("renders hours and drops a zero minute remainder", () => {
    expect(formatElapsed(isoMinus(3_600_000), NOW)).toBe("1h");
    expect(formatElapsed(isoMinus(3_600_000 + 24 * 60_000), NOW)).toBe("1h 24m");
  });

  it("renders days and drops a zero hour remainder", () => {
    expect(formatElapsed(isoMinus(86_400_000), NOW)).toBe("1d");
    expect(formatElapsed(isoMinus(2 * 86_400_000 + 3 * 3_600_000), NOW)).toBe("2d 3h");
  });

  it("clamps a future start time to zero rather than emitting a negative duration", () => {
    expect(formatElapsed(new Date(NOW + 5_000).toISOString(), NOW)).toBe("0s");
  });

  it("returns the empty marker for an unparseable timestamp", () => {
    expect(formatElapsed("not-a-date", NOW)).toBe(EMPTY_VALUE);
  });
});

describe("formatTokens / formatCost / shortCommitSha", () => {
  it("groups token counts", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(12_345)).toBe("12,345");
  });

  it("renders the empty marker for a null cost — local mode never has a pricing table", () => {
    expect(formatCost(null)).toBe(EMPTY_VALUE);
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("truncates a commit sha to eight characters and passes null through", () => {
    expect(shortCommitSha("0123456789abcdef")).toBe("01234567");
    expect(shortCommitSha(null)).toBeNull();
  });
});

describe("statusTimestamp", () => {
  const cases: [AgentStatus, string | null][] = [
    [{ kind: "running", startedAt: isoMinus(1000), lastHeartbeatAt: isoMinus(10) }, isoMinus(10)],
    [{ kind: "waiting", since: isoMinus(20) }, isoMinus(20)],
    [{ kind: "approval_required", requestedAt: isoMinus(30) }, isoMinus(30)],
    [{ kind: "blocked", blocker: "Permission required", since: isoMinus(40) }, isoMinus(40)],
    [{ kind: "failed", error: "boom", retryCount: 2, failedAt: isoMinus(50) }, isoMinus(50)],
    [{ kind: "completed", completedAt: isoMinus(60) }, isoMinus(60)],
    [{ kind: "paused", pausedAt: isoMinus(70) }, isoMinus(70)],
    [{ kind: "stale", lastHeartbeatAt: isoMinus(80) }, isoMinus(80)],
    [{ kind: "offline", lastSeenAt: isoMinus(90) }, isoMinus(90)],
    [{ kind: "offline", lastSeenAt: null }, null],
  ];

  it.each(cases)("reads the variant's own timestamp field for %o", (status, expected) => {
    expect(statusTimestamp(status)).toBe(expected);
  });
});

describe("retryCount / statusReason", () => {
  it("exposes retryCount only on the failed variant", () => {
    expect(retryCount({ kind: "failed", error: "boom", retryCount: 3, failedAt: isoMinus(1) })).toBe(3);
    expect(retryCount({ kind: "running", startedAt: isoMinus(2), lastHeartbeatAt: isoMinus(1) })).toBeNull();
    expect(retryCount({ kind: "completed", completedAt: isoMinus(1) })).toBeNull();
  });

  it("exposes a reason only for failed (error) and blocked (blocker)", () => {
    expect(statusReason({ kind: "failed", error: "Build failed", retryCount: 0, failedAt: isoMinus(1) })).toBe("Build failed");
    expect(statusReason({ kind: "blocked", blocker: "Awaiting approval", since: isoMinus(1) })).toBe("Awaiting approval");
    expect(statusReason({ kind: "waiting", since: isoMinus(1) })).toBeNull();
    expect(statusReason({ kind: "offline", lastSeenAt: null })).toBeNull();
  });
});
