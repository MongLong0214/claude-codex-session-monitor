import { NextResponse } from "next/server";

/**
 * The server binds 127.0.0.1 only (see package.json scripts), but a bound socket alone does not
 * stop DNS rebinding: a public hostname can resolve to 127.0.0.1 and a browser will happily send
 * the attacker's hostname in `Host`. Validating the hostname closes that hole. Any valid port is
 * allowed, but a present `Origin` must match the request's complete HTTP origin.
 */
const LOCAL_AUTHORITY_PATTERN = /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;
const MAX_JSON_BODY_BYTES = 64 * 1024;

type JsonBodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: NextResponse };

/** Distinguishable so route handlers can map only this failure to 403 and let real bugs surface as 500. */
export class LocalOnlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalOnlyError";
  }
}

/**
 * Parses a local HTTP authority from `Host`, rejecting paths, credentials and malformed brackets.
 */
function localOriginFromHostHeader(value: string, protocol: "http:" | "https:"): string | null {
  const trimmed = value.trim();
  if (!LOCAL_AUTHORITY_PATTERN.test(trimmed)) {
    return null;
  }

  try {
    const url = new URL(`${protocol}//${trimmed}`);
    return url.origin;
  } catch {
    return null;
  }
}

/** `Origin` is a serialized origin (`scheme://host[:port]`) or the literal string "null". */
function exactHttpOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === trimmed ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Throws when the request did not originate from this machine's loopback interface.
 * `Origin` is absent on most same-origin fetches and on curl — that is expected and allowed;
 * it is only rejected when present AND pointing somewhere other than loopback.
 */
export function assertLocalRequest(request: Request): void {
  const protocol = new URL(request.url).protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    throw new LocalOnlyError(`Request protocol is not allowed: ${protocol}`);
  }

  const host = request.headers.get("host");
  if (!host) {
    throw new LocalOnlyError("Missing Host header; unable to verify a local request.");
  }

  const localOrigin = localOriginFromHostHeader(host, protocol);
  if (!localOrigin) {
    throw new LocalOnlyError(`Host header is not allowed: ${host}`);
  }

  const origin = request.headers.get("origin");
  if (origin === null) {
    return;
  }

  if (exactHttpOrigin(origin) !== localOrigin) {
    throw new LocalOnlyError(`Origin header is not allowed: ${origin}`);
  }
}

export async function readJsonRequestBody(request: Request): Promise<JsonBodyResult> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 }),
    };
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    await request.body?.cancel();
    return { ok: false, response: NextResponse.json({ error: "Request body is too large." }, { status: 413 }) };
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return { ok: false, response: NextResponse.json({ error: "Unable to parse the JSON request body." }, { status: 400 }) };
  }

  const decoder = new TextDecoder();
  let raw = "";
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    size += chunk.value.byteLength;
    if (size > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      return { ok: false, response: NextResponse.json({ error: "Request body is too large." }, { status: 413 }) };
    }
    raw += decoder.decode(chunk.value, { stream: true });
  }
  raw += decoder.decode();

  try {
    const value: unknown = JSON.parse(raw);
    return { ok: true, value };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Unable to parse the JSON request body." }, { status: 400 }) };
  }
}

/**
 * Route-handler entry point: returns a 403 response to hand straight back to Next.js, or null
 * when the request is allowed. Non-LocalOnlyError failures are rethrown so they surface as 500s.
 */
export function guardLocalRequest(request: Request): NextResponse | null {
  try {
    assertLocalRequest(request);
    return null;
  } catch (error) {
    if (error instanceof LocalOnlyError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
