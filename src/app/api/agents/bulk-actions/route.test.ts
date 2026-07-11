import { beforeEach, describe, expect, it, vi } from "vitest";

type SnapshotStub = { readonly byId: Readonly<Record<string, unknown>> };

const repositories = vi.hoisted(() => ({
  getSnapshot: vi.fn<() => Promise<SnapshotStub>>(),
  executeBulk: vi.fn<(agentIds: string[], action: string, force?: boolean) => Promise<unknown[]>>(),
}));

vi.mock("@/data-access/repositories", () => ({
  dashboardRepository: { getSnapshot: repositories.getSnapshot },
  agentCommandRepository: { executeBulk: repositories.executeBulk },
}));

import { POST } from "./route";

function bulkRequest(body: string, contentType = "application/json"): Request {
  return new Request("http://localhost/api/agents/bulk-actions", {
    method: "POST",
    headers: { Host: "localhost", "Content-Type": contentType },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  repositories.getSnapshot.mockResolvedValue({ byId: { known: {} } });
  repositories.executeBulk.mockResolvedValue([
    { agentId: "known", action: "pause", status: "success", message: "paused" },
  ]);
});

describe("POST /api/agents/bulk-actions", () => {
  it("returns 415 for a non-JSON content type without exposing validation details", async () => {
    // Given
    const request = bulkRequest('{"agentIds":["known"],"action":"pause"}', "text/plain");

    // When
    const response = await POST(request);

    // Then
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(repositories.getSnapshot).not.toHaveBeenCalled();
  });

  it("returns 413 for an oversized raw body before JSON parsing", async () => {
    // Given
    const request = bulkRequest("{".repeat(65_537));

    // When
    const response = await POST(request);

    // Then
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(repositories.getSnapshot).not.toHaveBeenCalled();
  });

  it("returns a bounded generic 400 for an issue-amplifying body without calling repositories", async () => {
    // Given
    const requestBody = JSON.stringify({ agentIds: Array.from({ length: 5_000 }, () => ""), action: "pause" });
    const request = bulkRequest(requestBody);

    // When
    const response = await POST(request);
    const responseBody = await response.text();

    // Then
    expect(new TextEncoder().encode(requestBody).byteLength).toBeLessThanOrEqual(16 * 1024);
    expect(response.status).toBe(400);
    expect(new TextEncoder().encode(responseBody).byteLength).toBeLessThanOrEqual(256);
    expect(JSON.parse(responseBody)).toEqual({ error: expect.any(String) });
    expect(repositories.getSnapshot).not.toHaveBeenCalled();
    expect(repositories.executeBulk).not.toHaveBeenCalled();
  });

  it("executes only own allowlist ids and preserves ordered skipped results", async () => {
    // Given
    const agentIds = ["constructor", "known", "missing", "toString", "__proto__"];
    const request = bulkRequest(JSON.stringify({ agentIds, action: "pause" }));

    // When
    const response = await POST(request);

    // Then
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(repositories.executeBulk).toHaveBeenCalledWith(["known"], "pause", undefined);
    expect(await response.json()).toEqual({
      results: [
        { agentId: "constructor", action: "pause", status: "skipped", message: expect.any(String) },
        { agentId: "known", action: "pause", status: "success", message: "paused" },
        { agentId: "missing", action: "pause", status: "skipped", message: expect.any(String) },
        { agentId: "toString", action: "pause", status: "skipped", message: expect.any(String) },
        { agentId: "__proto__", action: "pause", status: "skipped", message: expect.any(String) },
      ],
    });
  });
});
