import { describe, expect, it } from "vitest";

import { assertLocalRequest, LocalOnlyError, readJsonRequestBody } from "./security";

function localRequest(headers: HeadersInit): Request {
  return new Request("http://localhost:3000/api/agents", { headers });
}

describe("assertLocalRequest", () => {
  it("allows a loopback Host when Origin is absent", () => {
    // Given
    const request = localRequest({ Host: "localhost:3000" });

    // When
    const act = () => assertLocalRequest(request);

    // Then
    expect(act).not.toThrow();
  });

  it.each(["[127.0.0.1]evil.test", "[127.0.0.1]:3000:evil", "[127.0.0.1]:"])(
    "rejects malformed bracket Host authority %s",
    (host) => {
      // Given
      const request = localRequest({ Host: host });

      // When
      const act = () => assertLocalRequest(request);

      // Then
      expect(act).toThrow(LocalOnlyError);
    },
  );

  it.each(["127.1", "2130706433"])("rejects nonliteral loopback Host alias %s", (host) => {
    // Given
    const request = localRequest({ Host: host });

    // When
    const act = () => assertLocalRequest(request);

    // Then
    expect(act).toThrow(LocalOnlyError);
  });

  it("rejects an Origin whose port differs from the Host authority", () => {
    // Given
    const request = localRequest({ Host: "localhost:3000", Origin: "http://localhost:3001" });

    // When
    const act = () => assertLocalRequest(request);

    // Then
    expect(act).toThrow(LocalOnlyError);
  });

  it.each(["https://localhost:3000", "http://localhost:3000/path", "ftp://localhost:3000"])(
    "rejects non-matching serialized HTTP Origin %s",
    (origin) => {
      // Given
      const request = localRequest({ Host: "localhost:3000", Origin: origin });

      // When
      const act = () => assertLocalRequest(request);

      // Then
      expect(act).toThrow(LocalOnlyError);
    },
  );

  it("allows an exact serialized HTTP Origin", () => {
    // Given
    const request = localRequest({ Host: "localhost:3000", Origin: "http://localhost:3000" });

    // When
    const act = () => assertLocalRequest(request);

    // Then
    expect(act).not.toThrow();
  });
});

describe("readJsonRequestBody", () => {
  it("cancels a body rejected by its declared byte length", async () => {
    // Given
    const request = new Request("http://localhost/api/agents/bulk-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "65537" },
      body: "{}",
    });

    // When
    const result = await readJsonRequestBody(request);

    // Then
    expect(result.ok).toBe(false);
    expect(request.bodyUsed).toBe(true);
  });
});
