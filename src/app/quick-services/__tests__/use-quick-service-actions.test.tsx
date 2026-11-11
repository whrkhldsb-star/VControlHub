import { act } from "@testing-library/react";
import { renderHookWithI18n as renderHook } from "@/lib/i18n/__tests__/test-helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuickServiceActions } from "../use-quick-service-actions";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

// Results are toasts: they show where the click was, however far down the page that is.
const addToast = vi.hoisted(() => vi.fn());
vi.mock("@/components/toast-provider", () => ({
  useToast: () => ({ addToast }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));
/** The latest result, in the terms the hook's callers use. */
function lastMessage(): { type: "ok" | "err"; text: string; options?: { duration?: number; action?: { label: string; href: string } } } | null {
  const call = addToast.mock.calls.at(-1);
  return call ? { type: call[0] === "success" ? "ok" : "err", text: call[1], options: call[2] } : null;
}

const okResp = (extra: Record<string, unknown> = {}) =>
  ({ success: true, queued: true, taskId: "job:test", ...extra });

const fetchCatalog = vi.fn(async () => {});
const fetchSources = vi.fn(async () => {});

describe("useQuickServiceActions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(csrfFetch).mockReset();
    addToast.mockReset();
    fetchCatalog.mockReset();
    fetchSources.mockReset();
    fetchCatalog.mockResolvedValue(undefined);
    fetchSources.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes a stable API shape", () => {
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    expect(lastMessage()).toBeNull();
    expect(result.current.actionSlug).toBeNull();
    expect(result.current.syncing).toBeNull();
    expect(typeof result.current.showMessage).toBe("function");
    expect(typeof result.current.doInstall).toBe("function");
    expect(typeof result.current.doAction).toBe("function");
    expect(typeof result.current.doUninstall).toBe("function");
    expect(typeof result.current.doSync).toBe("function");
    expect(typeof result.current.doToggleSource).toBe("function");
    expect(typeof result.current.doDeleteSource).toBe("function");
    expect(typeof result.current.doAddSource).toBe("function");
  });

  it("says the result in a toast: a failure stays longer, a queued task links to the task centre", async () => {
    // It was a notice at the top of the page that went away after four seconds: after "stop", "update" or
    // "uninstall" on a card further down, nothing changed where the click was — least of all the reason of a failure.
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    act(() => {
      result.current.showMessage({ type: "ok", text: "hello" });
    });
    expect(addToast).toHaveBeenLastCalledWith("success", "hello", { duration: undefined, action: undefined });
    act(() => {
      result.current.showMessage({ type: "err", text: "镜像拉取失败", taskId: "job:1" });
    });
    expect(addToast).toHaveBeenLastCalledWith("error", "镜像拉取失败", { duration: 10_000, action: { label: "查看任务中心", href: "/operation-tasks" } });
  });

  it("doInstall sets actionSlug during the call and clears it on success", async () => {
    vi.mocked(csrfFetch).mockResolvedValue(okResp({ taskId: "job:ins_1" }));
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    const preview = {
      action: "install" as const,
      item: { slug: "alist", name: "AList", defaultPort: 5244, port: null },
      port: 5244,
    };
    let promise!: Promise<void>;
    act(() => {
      promise = result.current.doInstall(preview);
    });
    expect(result.current.actionSlug).toBe("alist");
    await act(async () => {
      await promise;
    });
    expect(result.current.actionSlug).toBeNull();
    expect(lastMessage()?.type).toBe("ok");
    expect(lastMessage()?.text).toMatch(/安装已排队/);
    expect(csrfFetch).toHaveBeenCalledWith(
      "/api/quick-services",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ slug: "alist", customPort: 5244, serverId: null }),
      }),
    );
  });

  it("doInstall surfaces an error message on failure", async () => {
    vi.mocked(csrfFetch).mockRejectedValue(new Error("镜像拉取失败"));
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    await act(async () => {
      await result.current.doInstall({
        action: "install",
        item: { slug: "alist", name: "AList", defaultPort: 5244, port: null },
        port: 5244,
      });
    });
    expect(result.current.actionSlug).toBeNull();
    expect(lastMessage()?.type).toBe("err");
    expect(lastMessage()?.text).toBe("镜像拉取失败");
  });

  it("doAction 'start' queued produces a queued message and polls catalog until the worker settles", async () => {
    vi.mocked(csrfFetch).mockResolvedValue(okResp({ taskId: "job:start_1" }));
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    await act(async () => {
      await result.current.doAction("alist", "start");
    });
    expect(lastMessage()?.text).toMatch(/启动已排队/);
    expect(fetchCatalog).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_100);
    });
    expect(fetchCatalog).toHaveBeenCalledTimes(3);
  });

  it("doAction 'update' non-queued includes health and log details", async () => {
    vi.mocked(csrfFetch).mockResolvedValue({
      success: true,
      queued: false,
      health: "healthy",
      logTail: "line1\nline2\nline3",
    });
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    await act(async () => {
      await result.current.doAction("alist", "update");
    });
    expect(lastMessage()?.text).toMatch(/更新完成/);
    expect(lastMessage()?.text).toMatch(/健康状态：healthy/);
    expect(lastMessage()?.text).toMatch(/最近日志：line2 \/ line3/);
  });

  it("doUninstall with deleteVolumes true surfaces the right queued text", async () => {
    vi.mocked(csrfFetch).mockResolvedValue(okResp({ taskId: "job:un_1" }));
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    await act(async () => {
      await result.current.doUninstall({ slug: "alist", deleteVolumes: true });
    });
    expect(csrfFetch).toHaveBeenCalledWith(
      "/api/quick-services/alist",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ deleteVolumes: true, serverId: null }),
      }),
    );
    expect(lastMessage()?.text).toMatch(/卸载并删除数据目录已排队/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_100);
    });
    expect(fetchCatalog).toHaveBeenCalledTimes(3);
  });

  it("doUninstall non-queued keeps the data directory", async () => {
    vi.mocked(csrfFetch).mockResolvedValue({ success: true, queued: false });
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    await act(async () => {
      await result.current.doUninstall({ slug: "alist", deleteVolumes: false });
    });
    expect(lastMessage()?.text).toBe("已卸载，数据目录已保留");
  });

  it("doSync flips syncing state and refreshes both sources and catalog", async () => {
    vi.mocked(csrfFetch).mockResolvedValue({ success: true });
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    let promise!: Promise<void>;
    act(() => {
      promise = result.current.doSync("src_1");
    });
    expect(result.current.syncing).toBe("src_1");
    await act(async () => {
      await promise;
    });
    expect(result.current.syncing).toBeNull();
    expect(fetchSources).toHaveBeenCalledTimes(1);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    expect(lastMessage()?.text).toMatch(/同步完成/);
  });

  it("doToggleSource refreshes the catalog when disabling and when enabling", async () => {
    vi.mocked(csrfFetch).mockResolvedValue({ success: true });
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    await act(async () => {
      await result.current.doToggleSource("src_1", false);
    });
    expect(fetchSources).toHaveBeenCalledTimes(1);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);

    vi.mocked(csrfFetch).mockResolvedValue({ success: true });
    fetchSources.mockClear();
    fetchCatalog.mockClear();
    await act(async () => {
      await result.current.doToggleSource("src_1", true);
    });
    expect(fetchSources).toHaveBeenCalledTimes(1);
    // A re-enabled source's apps come back into the catalog.
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("doToggleSource on error says why", async () => {
    vi.mocked(csrfFetch).mockRejectedValue(new Error("应用源不存在"));
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    await act(async () => {
      await result.current.doToggleSource("src_1", true);
    });
    expect(lastMessage()?.type).toBe("err");
    expect(lastMessage()?.text).toBe("应用源不存在");

    vi.mocked(csrfFetch).mockRejectedValue({ status: 500 });
    await act(async () => {
      await result.current.doToggleSource("src_1", true);
    });
    expect(lastMessage()?.text).toBe("操作失败");
  });

  it("puts a slug and a source id into the address as one segment", async () => {
    // Slugs come from third-party catalogs: "a/b?x" asked another route.
    vi.mocked(csrfFetch).mockResolvedValue({ success: true });
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    await act(async () => {
      await result.current.doAction("feed-a/b?x", "stop");
      await result.current.doUninstall({ slug: "feed-a/b?x", deleteVolumes: false });
      await result.current.doDeleteSource("src 1&x");
    });
    const addresses = vi.mocked(csrfFetch).mock.calls.map(([address]) => address);
    expect(addresses).toEqual([
      "/api/quick-services/feed-a%2Fb%3Fx",
      "/api/quick-services/feed-a%2Fb%3Fx",
      "/api/app-sources?sourceId=src%201%26x",
    ]);
  });

  it("doDeleteSource refreshes both sources and catalog on success", async () => {
    vi.mocked(csrfFetch).mockResolvedValue({ success: true });
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    await act(async () => {
      await result.current.doDeleteSource("src_1");
    });
    expect(csrfFetch).toHaveBeenCalledWith(
      "/api/app-sources?sourceId=src_1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchSources).toHaveBeenCalledTimes(1);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    expect(lastMessage()?.text).toBe("源已删除");
  });

  it("doAddSource rejects an empty form and skips the network call", async () => {
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    await act(async () => {
      await result.current.doAddSource({
        name: "",
        displayName: "Foo",
        url: "https://x",
        type: "json",
      });
    });
    expect(csrfFetch).not.toHaveBeenCalled();
    expect(lastMessage()?.text).toMatch(/请先填写完整的源信息/);
  });

  it("doAddSource happy path trims and posts", async () => {
    vi.mocked(csrfFetch).mockResolvedValue({ success: true });
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    await act(async () => {
      await result.current.doAddSource({
        name: "  linuxserver  ",
        displayName: "  LinuxServer.io  ",
        url: "  https://example.com/apps.json  ",
        type: "linuxserver",
      });
    });
    expect(csrfFetch).toHaveBeenCalledWith(
      "/api/app-sources",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "linuxserver",
          displayName: "LinuxServer.io",
          url: "https://example.com/apps.json",
          type: "linuxserver",
        }),
      }),
    );
    expect(lastMessage()?.text).toBe("应用源已添加");
  });

  it("refreshes the catalog when a source is re-enabled, not only when disabled", async () => {
    // Re-enabling a synced source left its apps out of the catalog until reload.
    vi.mocked(csrfFetch).mockResolvedValue({});
    const { result } = renderHook(() => useQuickServiceActions({ fetchCatalog, fetchSources }));
    await act(async () => {
      await result.current.doToggleSource("src-1", true);
    });
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });
});
