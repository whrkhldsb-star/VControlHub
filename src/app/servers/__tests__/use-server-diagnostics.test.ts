import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { api } from "@/lib/http/api-client";
import { useServerDiagnostics } from "../use-server-diagnostics";

const prefs = vi.hoisted(() => ({ enabled: false, hydrated: true, intervalSec: 5 }));
vi.mock("../auto-probe-context", () => ({ useAutoProbeSettings: () => prefs }));
vi.mock("@/lib/http/api-client", () => ({ api: { get: vi.fn() } }));

const metrics = { cpu: { usagePercent: 12 }, memory: { usagePercent: 40 }, disk: [] };
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("server diagnostic lifecycle", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(api.get).mockReset(); prefs.enabled = false; });
  afterEach(() => { vi.useRealTimers(); });

  it("deduplicates manual probes and automatic ticks", async () => {
    prefs.enabled = true;
    const pending = deferred();
    vi.mocked(api.get).mockReturnValue(pending.promise);
    const { result } = renderHookWithI18n(() => useServerDiagnostics("a", true));
    await act(async () => { void result.current.runRealtimeDiagnostics(); await vi.advanceTimersByTimeAsync(5000); });
    expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(Response.json(metrics)); });
    expect(result.current.diagnosticRun.status).toBe("success");
  });

  it("aborts on node changes and ignores late results without unlocking the next request", async () => {
    const old = deferred();
    const current = deferred();
    vi.mocked(api.get).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { result, rerender, unmount } = renderHookWithI18n(({ id }) => useServerDiagnostics(id, true), { initialProps: { id: "a" } });
    act(() => { void result.current.runRealtimeDiagnostics(); });
    const oldSignal = vi.mocked(api.get).mock.calls[0]![1]?.signal;
    rerender({ id: "b" });
    expect(oldSignal?.aborted).toBe(true);
    act(() => { void result.current.runRealtimeDiagnostics(); });
    await act(async () => { old.resolve(Response.json(metrics)); });
    expect(result.current.diagnosticRun.status).toBe("loading");
    act(() => { void result.current.runRealtimeDiagnostics(); });
    expect(api.get).toHaveBeenCalledTimes(2);
    const signal = vi.mocked(api.get).mock.calls[1]![1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { current.resolve(Response.json(metrics)); });
  });

  it("expires a stuck transport and allows retry without accepting its late success", async () => {
    const old = deferred();
    vi.mocked(api.get).mockReturnValueOnce(old.promise).mockResolvedValueOnce(Response.json(metrics));
    const { result } = renderHookWithI18n(() => useServerDiagnostics("a", true));
    act(() => { void result.current.runRealtimeDiagnostics(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(result.current.diagnosticRun).toMatchObject({ status: "error" });
    expect(vi.mocked(api.get).mock.calls[0]![1]?.signal?.aborted).toBe(true);
    await act(async () => { await result.current.runRealtimeDiagnostics(); });
    expect(result.current.diagnosticRun.status).toBe("success");
    await act(async () => { old.resolve(Response.json({ error: "old failure" })); });
    expect(result.current.diagnosticRun.status).toBe("success");
  });

  it.each([null, {}, { ...metrics, cpu: { usagePercent: "12" } }, { ...metrics, disk: [{}] }])("rejects malformed 200 payloads: %j", async (payload) => {
    vi.mocked(api.get).mockResolvedValue(Response.json(payload));
    const { result } = renderHookWithI18n(() => useServerDiagnostics("a", true));
    await act(async () => { await result.current.runRealtimeDiagnostics(); });
    expect(result.current.diagnosticRun).toMatchObject({ status: "error", message: "探测返回的指标数据无效" });
  });

  it("does not probe disabled nodes", async () => {
    prefs.enabled = true;
    const { result } = renderHookWithI18n(() => useServerDiagnostics("a", false));
    await act(async () => { await result.current.runRealtimeDiagnostics(); await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.get).not.toHaveBeenCalled();
  });
});
