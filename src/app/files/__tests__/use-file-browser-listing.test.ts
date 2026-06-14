import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFileBrowserListing } from "../use-file-browser-listing";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const baseInitial = {
  currentPath: "/foo",
  nodeIdFilter: "node_1",
  searchQuery: "",
  searchScope: "current",
  nodes: [],
  entries: [],
};

describe("useFileBrowserListing", () => {
  beforeEach(() => {
    vi.mocked(csrfFetch).mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes the initial data and a fresh selectionEpoch", () => {
    const { result } = renderHook(() =>
      useFileBrowserListing({ initialData: baseInitial }),
    );
    expect(result.current.data).toBe(baseInitial);
    expect(result.current.loading).toBe(false);
    expect(result.current.listError).toBeNull();
    expect(result.current.selectionEpoch).toBe(0);
    expect(result.current.searchInput).toBe("");
  });

  it("fetchFiles sets loading, populates data, clears loading on success", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({
      ...baseInitial,
      currentPath: "/bar",
      entries: [{ id: "e1" }],
    });
    const { result } = renderHook(() =>
      useFileBrowserListing({ initialData: baseInitial }),
    );
    let promise!: Promise<void>;
    act(() => {
      promise = result.current.fetchFiles("/bar");
    });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await promise;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data.currentPath).toBe("/bar");
  });

  it("fetchFiles builds the right query string (path, q, scope, nodeId)", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({ ...baseInitial });
    const { result } = renderHook(() =>
      useFileBrowserListing({ initialData: baseInitial }),
    );
    await act(async () => {
      await result.current.fetchFiles("/dir", "report", "all", "node_2");
    });
    const [calledUrl, calledOpts] = vi.mocked(csrfFetch).mock.calls[0]!;
    expect(calledUrl).toBe(
      "/api/files/list?path=%2Fdir&q=report&scope=all&nodeId=node_2",
    );
    expect(calledOpts).toMatchObject({ signal: expect.any(Object) });
  });

  it("fetchFiles omits the 'scope' param when it is 'current'", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({ ...baseInitial });
    const { result } = renderHook(() =>
      useFileBrowserListing({ initialData: baseInitial }),
    );
    await act(async () => {
      await result.current.fetchFiles("/dir", undefined, "current", "node_1");
    });
    expect(vi.mocked(csrfFetch).mock.calls[0]![0]).toBe(
      "/api/files/list?path=%2Fdir&nodeId=node_1",
    );
  });

  it("fetchFiles sets listError to the sync warning when the API returns one", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({
      ...baseInitial,
      syncWarning: "远端 SFTP 节点暂时无法访问",
    });
    const { result } = renderHook(() =>
      useFileBrowserListing({ initialData: baseInitial }),
    );
    await act(async () => {
      await result.current.fetchFiles("/bar");
    });
    expect(result.current.listError).toBe("远端 SFTP 节点暂时无法访问");
  });

  it("fetchFiles surfaces a non-abort error and clears loading", async () => {
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("网络异常"));
    const { result } = renderHook(() =>
      useFileBrowserListing({ initialData: baseInitial }),
    );
    await act(async () => {
      await result.current.fetchFiles("/bar");
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.listError).toBe("网络异常");
  });

  it("fetchFiles aborts the previous request when called twice quickly", async () => {
    let firstAbort: AbortSignal | undefined;
    let firstAborted = false;
    vi.mocked(csrfFetch).mockImplementationOnce((url, init) => {
      firstAbort = (init as { signal?: AbortSignal })?.signal;
      // Tie the abort to the first fetch so the test can observe it.
      if (firstAbort) {
        firstAbort.addEventListener("abort", () => {
          firstAborted = true;
        });
      }
      // Never resolve — the test will trigger the abort by calling
      // fetchFiles again.
      return new Promise(() => {}) as Promise<unknown>;
    });
    vi.mocked(csrfFetch).mockResolvedValueOnce({ ...baseInitial });

    const { result } = renderHook(() =>
      useFileBrowserListing({ initialData: baseInitial }),
    );
    act(() => {
      void result.current.fetchFiles("/a");
    });
    expect(firstAborted).toBe(false);
    await act(async () => {
      await result.current.fetchFiles("/b");
    });
    expect(firstAborted).toBe(true);
  });

  it("fetchFiles bumps selectionEpoch when resetSelection is true", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({ ...baseInitial });
    const { result } = renderHook(() =>
      useFileBrowserListing({ initialData: baseInitial }),
    );
    expect(result.current.selectionEpoch).toBe(0);
    await act(async () => {
      await result.current.fetchFiles("/bar", undefined, undefined, undefined, {
        resetSelection: true,
      });
    });
    expect(result.current.selectionEpoch).toBe(1);
  });

  it("fetchFiles does not bump selectionEpoch when resetSelection is omitted", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({ ...baseInitial });
    const { result } = renderHook(() =>
      useFileBrowserListing({ initialData: baseInitial }),
    );
    await act(async () => {
      await result.current.fetchFiles("/bar");
    });
    expect(result.current.selectionEpoch).toBe(0);
  });

  it("fetchFiles calls history.replaceState by default and pushState when asked", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({ ...baseInitial });
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const pushSpy = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() =>
      useFileBrowserListing({ initialData: baseInitial }),
    );
    await act(async () => {
      await result.current.fetchFiles("/x");
    });
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();
    replaceSpy.mockClear();
    pushSpy.mockClear();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ ...baseInitial });
    await act(async () => {
      await result.current.fetchFiles("/y", undefined, undefined, undefined, {
        history: "push",
      });
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("fetchFiles with history='none' leaves the URL alone", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({ ...baseInitial });
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const pushSpy = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() =>
      useFileBrowserListing({ initialData: baseInitial }),
    );
    await act(async () => {
      await result.current.fetchFiles("/x", undefined, undefined, undefined, {
        history: "none",
      });
    });
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("handleSearch reads searchInput and the latest data, then calls fetchFiles with resetSelection", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({ ...baseInitial, searchQuery: "q" });
    const { result } = renderHook(() =>
      useFileBrowserListing({ initialData: baseInitial }),
    );
    act(() => {
      result.current.setSearchInput("q");
    });
    await act(async () => {
      result.current.handleSearch({
        preventDefault: () => {},
      } as unknown as React.FormEvent);
    });
    expect(vi.mocked(csrfFetch).mock.calls[0]![0]).toBe(
      "/api/files/list?path=%2Ffoo&q=q&nodeId=node_1",
    );
  });

  it("handleScopeChange keeps the active search query but switches scope", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({ ...baseInitial, searchQuery: "alpha" });
    const { result } = renderHook(() =>
      useFileBrowserListing({ initialData: baseInitial }),
    );
    // First fetch to put a real `searchQuery` into the data.
    await act(async () => {
      await result.current.fetchFiles("/foo", "alpha");
    });
    vi.mocked(csrfFetch).mockReset();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ ...baseInitial, searchQuery: "alpha" });
    await act(async () => {
      result.current.handleScopeChange("all");
    });
    expect(vi.mocked(csrfFetch).mock.calls[0]![0]).toBe(
      "/api/files/list?path=%2Ffoo&q=alpha&scope=all&nodeId=node_1",
    );
  });

  it("exposes mobileSidebarOpen only when manageMobileSidebar is true", () => {
    const off = renderHook(() =>
      useFileBrowserListing({ initialData: baseInitial }),
    );
    expect(off.result.current.mobileSidebarOpen).toBeUndefined();
    off.unmount();
    const on = renderHook(() =>
      useFileBrowserListing({
        initialData: baseInitial,
        manageMobileSidebar: true,
      }),
    );
    expect(on.result.current.mobileSidebarOpen).toBe(false);
    act(() => {
      on.result.current.setMobileSidebarOpen!(true);
    });
    expect(on.result.current.mobileSidebarOpen).toBe(true);
  });

  it("reacts to popstate by re-fetching from the URL with resetSelection + history:none", async () => {
    vi.mocked(csrfFetch).mockResolvedValue({ ...baseInitial, currentPath: "/pop" });
    // Seed an initial state with a different search query than the URL.
    const { result } = renderHook(() =>
      useFileBrowserListing({ initialData: { ...baseInitial, searchQuery: "stale" } }),
    );
    // Replace the current URL so the hook can read a fresh state.
    window.history.replaceState(
      null,
      "",
      "/files?path=%2Fpop&q=fresh&scope=all&nodeId=node_2",
    );
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() =>
      expect(vi.mocked(csrfFetch)).toHaveBeenCalledWith(
        "/api/files/list?path=%2Fpop&q=fresh&scope=all&nodeId=node_2",
        expect.objectContaining({ signal: expect.any(Object) }),
      ),
    );
    expect(result.current.searchInput).toBe("fresh");
  });
});
