import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DIRECT_GATEWAY_DEFAULT_HEALTH_PATH,
  DIRECT_GATEWAY_DEFAULT_PORT,
  DIRECT_GATEWAY_PROBE_TIMEOUT_MS,
  checkDirectGatewayPublicExposure,
  logDirectGatewayExposureResult,
  scheduleDirectGatewayExposureProbe,
} from "@/lib/server/direct-gateway-probe";

const originalPublicHost = process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST;
const originalDirectPort = process.env.DIRECT_PORT;

afterEach(() => {
  if (originalPublicHost === undefined) {
    delete process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST;
  } else {
    process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST = originalPublicHost;
  }
  if (originalDirectPort === undefined) {
    delete process.env.DIRECT_PORT;
  } else {
    process.env.DIRECT_PORT = originalDirectPort;
  }
  vi.restoreAllMocks();
});

function mockFetch(impl: Parameters<typeof fetch>[1] extends infer _ ? (url: string) => Promise<Response> : never) {
  return vi.fn(async (_url: string) => impl(_url));
}

describe("checkDirectGatewayPublicExposure", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST;
    delete process.env.DIRECT_PORT;
  });

  it("returns exposed=false with unknown host when no public host is configured", async () => {
    const result = await checkDirectGatewayPublicExposure();
    expect(result.exposed).toBe(false);
    expect(result.host).toBe("(unknown)");
    expect(result.port).toBe(DIRECT_GATEWAY_DEFAULT_PORT);
    expect(result.url).toBe("");
    expect(result.reason).toMatch(/no public host/);
    expect(result.status).toBeUndefined();
  });

  it("returns exposed=true when the gateway returns HTTP 200 over the public host", async () => {
    const fetchMock = mockFetch(async () => new Response("ok", { status: 200 }));
    const result = await checkDirectGatewayPublicExposure({
      publicHost: "82.158.91.159",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.exposed).toBe(true);
    expect(result.host).toBe("82.158.91.159");
    expect(result.port).toBe(DIRECT_GATEWAY_DEFAULT_PORT);
    expect(result.url).toBe(`http://82.158.91.159:${DIRECT_GATEWAY_DEFAULT_PORT}${DIRECT_GATEWAY_DEFAULT_HEALTH_PATH}`);
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://82.158.91.159:${DIRECT_GATEWAY_DEFAULT_PORT}${DIRECT_GATEWAY_DEFAULT_HEALTH_PATH}`,
      expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
    );
  });

  it("returns exposed=false when the gateway responds with non-200 status (e.g. 403 invalid signature)", async () => {
    const fetchMock = mockFetch(async () => new Response("forbidden", { status: 403 }));
    const result = await checkDirectGatewayPublicExposure({
      publicHost: "82.158.91.159",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.exposed).toBe(false);
    expect(result.status).toBe(403);
    expect(result.reason).toMatch(/HTTP 403/);
  });

  it("returns exposed=false when the fetch throws (connection refused / timeout / DNS)", async () => {
    const fetchMock = mockFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await checkDirectGatewayPublicExposure({
      publicHost: "82.158.91.159",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.exposed).toBe(false);
    expect(result.reason).toMatch(/connection failed/);
    expect(result.reason).toMatch(/ECONNREFUSED/);
    expect(result.status).toBeUndefined();
  });

  it("respects explicit port and health path overrides", async () => {
    const fetchMock = mockFetch(async () => new Response("ok", { status: 200 }));
    const result = await checkDirectGatewayPublicExposure({
      publicHost: "vch.example.com",
      port: 39090,
      healthPath: "/custom-health",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.exposed).toBe(true);
    expect(result.url).toBe("http://vch.example.com:39090/custom-health");
    expect(result.port).toBe(39090);
  });

  it("uses NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST from process.env when input.publicHost is omitted", async () => {
    process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST = "203.0.113.7";
    const fetchMock = mockFetch(async () => new Response("ok", { status: 200 }));
    const result = await checkDirectGatewayPublicExposure({
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.host).toBe("203.0.113.7");
    expect(result.exposed).toBe(true);
  });

  it("parses DIRECT_PORT from process.env when input.port is omitted", async () => {
    process.env.DIRECT_PORT = "39090";
    process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST = "82.158.91.159";
    const fetchMock = mockFetch(async () => new Response("ok", { status: 200 }));
    const result = await checkDirectGatewayPublicExposure({
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.port).toBe(39090);
    expect(result.url).toBe("http://82.158.91.159:39090/__vch_health");
  });

  it("aborts the request after the configured timeout when the fetch never settles", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const probePromise = checkDirectGatewayPublicExposure({
      publicHost: "82.158.91.159",
      timeoutMs: 50,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await probePromise;
    expect(result.exposed).toBe(false);
    expect(result.reason).toMatch(/aborted/);
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("exposes the documented default timeout constant for downstream configuration", () => {
    expect(DIRECT_GATEWAY_PROBE_TIMEOUT_MS).toBe(3000);
  });
});

describe("logDirectGatewayExposureResult", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    infoSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("emits a warning when the gateway is publicly reachable", () => {
    logDirectGatewayExposureResult({
      exposed: true,
      host: "82.158.91.159",
      port: 31888,
      url: "http://82.158.91.159:31888/__vch_health",
      reason: "HTTP 200 from http://82.158.91.159:31888/__vch_health",
      status: 200,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = warnSpy.mock.calls[0]?.[0] as string | undefined;
    expect(line).toContain("Direct Gateway 公网可达");
    expect(line).toContain("82.158.91.159");
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("emits info (not warn) when the host is unknown", () => {
    logDirectGatewayExposureResult({
      exposed: false,
      host: "(unknown)",
      port: 31888,
      url: "",
      reason: "no public host configured",
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("emits info (not warn) when the gateway is not publicly exposed", () => {
    logDirectGatewayExposureResult({
      exposed: false,
      host: "82.158.91.159",
      port: 31888,
      url: "http://82.158.91.159:31888/__vch_health",
      reason: "connection failed: ECONNREFUSED",
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("scheduleDirectGatewayExposureProbe", () => {
  it("is fire-and-forget: returns undefined without throwing", () => {
    expect(() => scheduleDirectGatewayExposureProbe({ publicHost: "82.158.91.159" })).not.toThrow();
  });

  it("schedules the probe asynchronously and never rejects the caller", async () => {
    delete process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST;
    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // No public host → checkDirectGatewayPublicExposure returns unknown-host result
    // → logDirectGatewayExposureResult emits info. The error path is unreachable here.
    scheduleDirectGatewayExposureProbe();
    // Wait for setImmediate to flush; 10 ms is plenty
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(infoSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
