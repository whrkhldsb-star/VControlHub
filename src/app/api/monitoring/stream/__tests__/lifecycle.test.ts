import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ collect: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  getSessionCookieName: () => "session",
  verifySessionToken: vi.fn(async () => ({ userId: "lifecycle-user", roles: ["admin"], permissions: ["health:read"] })),
}));

vi.mock("@/lib/monitoring/collector", () => ({ collectMonitoringStats: mocks.collect }));
vi.mock("@/lib/http/api-guard", () => ({ withApiRoute: mocks.guard }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mocks.collect.mockReset().mockResolvedValue({ timestamp: 1, cpu: 0 });
  mocks.guard.mockReset().mockImplementation((_request, _options, handler) => handler({ session: { userId: "lifecycle-user", roles: ["admin"] } }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("monitoring stream lifecycle", () => {
  it("does not reserve connections or start timers for already aborted requests", async () => {
    const { GET } = await import("../route");
    for (let index = 0; index < 6; index++) {
      const abort = new AbortController();
      abort.abort();
      const response = await GET(new Request("http://local/api/monitoring/stream", { signal: abort.signal }));
      expect(response.status).toBe(200);
      expect(await response.body!.getReader().read()).toEqual({ done: true, value: undefined });
    }
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors cancellation while authorization is pending", async () => {
    const { GET } = await import("../route");
    let authenticate!: () => void;
    mocks.guard.mockImplementationOnce(async (_request, _options, handler) => {
      await new Promise<void>((resolve) => { authenticate = resolve; });
      return handler({ session: { userId: "lifecycle-user", roles: ["admin"] } });
    });
    const abort = new AbortController();
    const pending = GET(new Request("http://local/api/monitoring/stream", { signal: abort.signal }));
    abort.abort();
    authenticate();
    const response = await pending;
    expect(await response.body!.getReader().read()).toEqual({ done: true, value: undefined });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the abort listener, all timers and the connection slot on consumer cancellation", async () => {
    const { GET } = await import("../route");
    for (let index = 0; index < 6; index++) {
      const request = new Request("http://local/api/monitoring/stream", { headers: { cookie: "session=test" } });
      const add = vi.spyOn(request.signal, "addEventListener");
      const remove = vi.spyOn(request.signal, "removeEventListener");
      const response = await GET(request);
      expect(response.status).toBe(200);
      await response.body!.cancel();
      expect(remove).toHaveBeenCalledWith("abort", add.mock.calls.find(([type]) => type === "abort")![1]);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("releases the slot when the initial collector fails", async () => {
    const { GET } = await import("../route");
    for (let index = 0; index < 6; index++) {
      // Collection is async now, so the failure surfaces through the stream
      // (controller.error), not as a rejected GET promise.
      mocks.collect.mockImplementationOnce(() => Promise.reject(new Error("collector failed")));
      const response = await GET(new Request("http://local/api/monitoring/stream", { headers: { cookie: "session=test" } }));
      expect(response.status).toBe(200);
      await expect(response.body!.getReader().read()).rejects.toThrow("collector failed");
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("terminates an open stream when the account loses the administrator role", async () => {
    const { GET } = await import("../route");
    const { verifySessionToken } = await import("@/lib/auth/session");
    const response = await GET(new Request("http://local/api/monitoring/stream", { headers: { cookie: "session=test" } }));
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    vi.mocked(verifySessionToken).mockResolvedValueOnce({
      userId: "lifecycle-user", username: "former-admin", roles: [], permissions: ["health:read"],
      mustChangePassword: false, currentTeamId: null,
    });
    const next = expect(reader.read()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5_000);
    await next;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds queued snapshots while a reader is stalled", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request("http://local/api/monitoring/stream", { headers: { cookie: "session=test" } }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.collect).toHaveBeenCalledTimes(1);
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.collect).toHaveBeenCalledTimes(2);
    await reader.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
});
