import { describe, expect, it } from "vitest";
import { STATUS_DOT_VARIANT, STATUS_LABEL } from "./status-presentation";

describe("status presentation", () => {
  it("uses concise English labels for every agent status", () => {
    expect(STATUS_LABEL).toEqual({
      running: "Running",
      waiting: "Waiting",
      approval_required: "Approval required",
      blocked: "Blocked",
      failed: "Failed",
      completed: "Completed",
      paused: "Paused",
      stale: "Stale",
      offline: "Offline",
    });
  });

  it("reserves semantic color for operational meaning", () => {
    expect(STATUS_DOT_VARIANT.running).toBe("success");
    expect(STATUS_DOT_VARIANT.waiting).toBe("warning");
    expect(STATUS_DOT_VARIANT.failed).toBe("error");
    expect(STATUS_DOT_VARIANT.completed).toBe("neutral");
    expect(STATUS_DOT_VARIANT.offline).toBe("neutral");
  });
});
