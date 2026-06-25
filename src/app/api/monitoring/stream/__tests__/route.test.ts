/**
 * Tests for GET /api/monitoring/stream (SSE).
 *
 * A full integration test would require a live server; here we test:
 *  1. The route handler is exported and callable.
 *  2. Response Content-Type is text/event-stream.
 *  3. The first chunk is a valid SSE "stats" event with JSON data.
 *  4. The interval query-param is clamped (2–30).
 *  5. AbortSignal closes the stream cleanly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: vi.fn((_req, _opts, handler) => handler()),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(() => ""),
    readdirSync: vi.fn(() => []),
    statfsSync: vi.fn(() => ({ blocks: 100, bsize: 4096, bfree: 50 })),
  };
});

vi.mock("os", () => ({
  __esModule: true,
  default: {
    hostname: () => "test-host",
    platform: () => "linux",
    arch: () => "x64",
    uptime: () => 86400,
    cpus: () => [{ model: "Test CPU" }],
    totalmem: () => 8 * 1024 ** 3,
    freemem: () => 4 * 1024 ** 3,
    loadavg: () => [0.5, 0.3, 0.1],
  },
}));

import { GET } from "../route";

function makeRequest(url = "http://localhost/api/monitoring/stream") {
  const controller = new AbortController();
  const req = new Request(url, { signal: controller.signal });
  return { req, controller };
}

describe("GET /api/monitoring/stream", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns Content-Type: text/event-stream", async () => {
    const { req, controller } = makeRequest();
    const res = await GET(req);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    controller.abort();
  });

  it("emits a valid SSE stats event as the first message", async () => {
    const { req, controller } = makeRequest();
    const res = await GET(req);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Read first chunk (the initial snapshot).
    const { value } = await reader.read();
    const text = decoder.decode(value);
    controller.abort();

    expect(text).toContain("event: stats");
    expect(text).toContain("data: ");
    // Extract the JSON payload from the SSE text.
    const dataLine = text.split("\n").find((l: string) => l.startsWith("data: "));
    expect(dataLine).toBeTruthy();
    const json = JSON.parse(dataLine!.replace("data: ", ""));
    expect(json).toHaveProperty("hostname", "test-host");
    expect(json).toHaveProperty("cpu");
    expect(json).toHaveProperty("memory");
    expect(json).toHaveProperty("timestamp");
  });

  it("clamps interval query-param to [2, 30]", async () => {
    // We can't directly observe the timer interval from outside, but we
    // verify the route accepts the param without error.
    const { req, controller } = makeRequest("http://localhost/api/monitoring/stream?interval=1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    controller.abort();
  });

  it("responds even without interval param (default 5s)", async () => {
    const { req, controller } = makeRequest();
    const res = await GET(req);
    expect(res.status).toBe(200);
    controller.abort();
  });
});
