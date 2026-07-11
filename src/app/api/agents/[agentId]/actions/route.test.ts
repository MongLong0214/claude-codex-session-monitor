import { beforeEach, describe, expect, it, vi } from "vitest";

type SnapshotStub = { readonly byId: Readonly<Record<string, unknown>> };

const repositories = vi.hoisted(() => ({
  getSnapshot: vi.fn<() => Promise<SnapshotStub>>(),
  execute: vi.fn<(agentId: string, request: unknown) => Promise<unknown>>(),
}));

vi.mock("@/data-access/repositories", () => ({
  dashboardRepository: { getSnapshot: repositories.getSnapshot },
  agentCommandRepository: { execute: repositories.execute },
}));

import { POST } from "./route";

function actionRequest(body: string, contentType = "application/json"): Request {
  return new Request("http://localhost/api/agents/known/actions", {
    method: "POST",
    headers: { Host: "localhost", "Content-Type": contentType },
    body,
  });
}

function context(agentId: string) {
  return { params: Promise.resolve({ agentId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  repositories.getSnapshot.mockResolvedValue({ byId: { known: {} } });
  repositories.execute.mockResolvedValue({
    agentId: "known",
    action: "pause",
    status: "success",
    message: "paused",
  });
});

describe("POST /api/agents/[agentId]/actions", () => {
  it("returns 415 for a non-JSON content type without exposing validation details", async () => {
    // Given
    const request = actionRequest('{"action":"pause"}', "text/plain");

    // When
    const response = await POST(request, context("known"));

    // Then
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(repositories.getSnapshot).not.toHaveBeenCalled();
  });

  it("returns 413 for an oversized raw body before JSON parsing", async () => {
    // Given
    const request = actionRequest("{".repeat(65_537));

    // When
    const response = await POST(request, context("known"));

    // Then
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(repositories.getSnapshot).not.toHaveBeenCalled();
  });

  it("returns a bounded generic 400 for an invalid action body without calling repositories", async () => {
    // Given
    const request = actionRequest('{"action":"invalid"}');

    // When
    const response = await POST(request, context("known"));
    const responseBody = await response.text();

    // Then
    expect(response.status).toBe(400);
    expect(new TextEncoder().encode(responseBody).byteLength).toBeLessThanOrEqual(256);
    expect(JSON.parse(responseBody)).toEqual({ error: expect.any(String) });
    expect(repositories.getSnapshot).not.toHaveBeenCalled();
    expect(repositories.execute).not.toHaveBeenCalled();
  });

  it.each(["constructor", "toString", "__proto__"])(
    "returns 404 for inherited allowlist key %s without executing an action",
    async (agentId) => {
      // Given
      repositories.getSnapshot.mockResolvedValue({ byId: {} });

      // When
      const response = await POST(actionRequest('{"action":"pause"}'), context(agentId));

      // Then
      expect(response.status).toBe(404);
      expect(repositories.execute).not.toHaveBeenCalled();
    },
  );

  it.each(["", "x".repeat(257)])("returns 400 for invalid route agent id length", async (agentId) => {
    // Given
    const request = actionRequest('{"action":"pause"}');

    // When
    const response = await POST(request, context(agentId));

    // Then
    expect(response.status).toBe(400);
    expect(repositories.getSnapshot).not.toHaveBeenCalled();
  });

  it("executes a valid action and keeps the response uncached", async () => {
    // Given
    const request = actionRequest('{"action":"pause"}');

    // When
    const response = await POST(request, context("known"));

    // Then
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(repositories.execute).toHaveBeenCalledWith("known", { action: "pause" });
  });
});
