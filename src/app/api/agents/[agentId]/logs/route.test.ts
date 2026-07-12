import { beforeEach, describe, expect, it, vi } from "vitest";

type SnapshotStub = { readonly byId: Readonly<Record<string, unknown>> };

const repositories = vi.hoisted(() => ({
  getSnapshot: vi.fn<() => Promise<SnapshotStub>>(),
  readLines: vi.fn<(agentId: string, limit: number) => Promise<unknown>>(),
}));

vi.mock("@/data-access/repositories", () => ({
  dashboardRepository: { getSnapshot: repositories.getSnapshot },
  agentLogRepository: { readLines: repositories.readLines },
}));

import { GET } from "./route";

function logRequest(query = ""): Request {
  return new Request(`http://localhost/api/agents/known/logs${query}`, { headers: { Host: "localhost" } });
}

function context(agentId: string) {
  return { params: Promise.resolve({ agentId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  repositories.getSnapshot.mockResolvedValue({ byId: { known: {} } });
  repositories.readLines.mockResolvedValue({ agentId: "known", lines: [], isTruncated: false });
});

describe("GET /api/agents/[agentId]/logs", () => {
  it("returns a bounded generic 400 for an invalid limit without calling repositories", async () => {
    // Given
    const request = logRequest("?limit=invalid");

    // When
    const response = await GET(request, context("known"));
    const responseBody = await response.text();

    // Then
    expect(response.status).toBe(400);
    expect(new TextEncoder().encode(responseBody).byteLength).toBeLessThanOrEqual(256);
    expect(JSON.parse(responseBody)).toEqual({ error: "Invalid limit value." });
    expect(repositories.getSnapshot).not.toHaveBeenCalled();
    expect(repositories.readLines).not.toHaveBeenCalled();
  });

  it.each(["constructor", "toString", "__proto__"])(
    "returns 404 for inherited allowlist key %s without reading logs",
    async (agentId) => {
      // Given
      repositories.getSnapshot.mockResolvedValue({ byId: {} });

      // When
      const response = await GET(logRequest(), context(agentId));

      // Then
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: `Unknown agent: ${agentId}` });
      expect(repositories.readLines).not.toHaveBeenCalled();
    },
  );

  it.each(["", "x".repeat(257)])("returns 400 for invalid route agent id length", async (agentId) => {
    // Given
    const request = logRequest();

    // When
    const response = await GET(request, context(agentId));

    // Then
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid agent ID." });
    expect(repositories.getSnapshot).not.toHaveBeenCalled();
  });

  it("reads a known agent's logs and keeps the response uncached", async () => {
    // Given
    const request = logRequest();

    // When
    const response = await GET(request, context("known"));

    // Then
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(repositories.readLines).toHaveBeenCalledWith("known", 500);
  });
});
