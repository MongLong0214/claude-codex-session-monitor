import { describe, expect, it } from "vitest";

import { logLinesFromClaudeCodeTail } from "./claude-code-logs";

const TIMESTAMP = "2026-07-11T12:00:00.000Z";

function userLine(text: string): string {
  return JSON.stringify({ type: "user", timestamp: TIMESTAMP, message: { content: text } });
}

describe("logLinesFromClaudeCodeTail", () => {
  it("parses indented JSON and skips malformed or truncated lines", () => {
    const tail = ["  {truncated", `  ${userLine("kept")}`, "not json"].join("\n");

    const result = logLinesFromClaudeCodeTail(tail, 10);

    expect(result.lines.map((line) => line.text)).toEqual(["kept"]);
  });

  it("keeps same-timestamp ids stable when the semantic limit slides", () => {
    const tail = [userLine("first"), userLine("second"), userLine("third")].join("\n");

    const all = logLinesFromClaudeCodeTail(tail, 3);
    const limited = logLinesFromClaudeCodeTail(tail, 2);

    expect(limited.lines.map((line) => line.id)).toEqual(all.lines.slice(-2).map((line) => line.id));
    expect(limited.droppedCount).toBe(1);
  });
});
