import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuickServiceActions } from "../use-quick-service-actions";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const okResp = (extra: Record<string, unknown> = {}) =>
  ({ success: true, queued: true, taskId: "job:test", ...extra });

const fetchCatalog = vi.fn(async () => {});
const fetchSources = vi.fn(async () => {});

describe("useQuickServiceActions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(csrfFetch).mockReset();
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
    expect(result.current.message).toBeNull();
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

  it("auto-dismisses a message after 4 seconds", async () => {
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    act(() => {
      result.current.showMessage({ type: "ok", text: "hello" });
    });
    expect(result.current.message?.text).toBe("hello");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(result.current.message).toBeNull();
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
    expect(result.current.message?.type).toBe("ok");
    expect(result.current.message?.text).toMatch(/安装已排队/);
    expect(csrfFetch).toHaveBeenCalledWith(
      "/api/quick-services",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ slug: "alist", customPort: 5244 }),
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
    expect(result.current.message?.type).toBe("err");
    expect(result.current.message?.text).toBe("镜像拉取失败");
  });

  it("doAction 'start' queued produces a queued message and refreshes catalog", async () => {
    vi.mocked(csrfFetch).mockResolvedValue(okResp({ taskId: "job:start_1" }));
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    await act(async () => {
      await result.current.doAction("alist", "start");
    });
    expect(result.current.message?.text).toMatch(/启动已排队/);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
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
    expect(result.current.message?.text).toMatch(/更新完成/);
    expect(result.current.message?.text).toMatch(/健康状态：healthy/);
    expect(result.current.message?.text).toMatch(/最近日志：line2 \/ line3/);
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
        body: JSON.stringify({ deleteVolumes: true }),
      }),
    );
    expect(result.current.message?.text).toMatch(/卸载并删除数据目录已排队/);
  });

  it("doUninstall non-queued keeps the data directory", async () => {
    vi.mocked(csrfFetch).mockResolvedValue({ success: true, queued: false });
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    await act(async () => {
      await result.current.doUninstall({ slug: "alist", deleteVolumes: false });
    });
    expect(result.current.message?.text).toBe("已卸载，数据目录已保留");
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
    expect(result.current.message?.text).toMatch(/同步完成/);
  });

  it("doToggleSource disable triggers a catalog refresh, enable does not", async () => {
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
    expect(fetchCatalog).not.toHaveBeenCalled();
  });

  it("doToggleSource on error surfaces a friendly message", async () => {
    vi.mocked(csrfFetch).mockRejectedValue(new Error("network"));
    const { result } = renderHook(() =>
      useQuickServiceActions({ fetchCatalog, fetchSources }),
    );
    await act(async () => {
      await result.current.doToggleSource("src_1", true);
    });
    expect(result.current.message?.type).toBe("err");
    expect(result.current.message?.text).toBe("操作失败");
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
    expect(result.current.message?.text).toBe("源已删除");
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
    expect(result.current.message?.text).toMatch(/请先填写完整的源信息/);
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
    expect(result.current.message?.text).toBe("应用源已添加");
  });
});
