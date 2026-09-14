import { useState } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { UnifiedFileSearch } from "../unified-file-search";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("UnifiedFileSearch request lifecycle", () => {
  it("restores the recursive filename scope from navigation", () => {
    const onSearch = vi.fn();
    renderWithI18n(<UnifiedFileSearch searchInput="report" onSearchInputChange={vi.fn()} onFilenameSearch={onSearch} initialScope="all" />, { locale: "en" });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onSearch).toHaveBeenCalledWith("all");
  });

  it("cancels content search when switching modes and ignores a late success", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    const onSearch = vi.fn();
    renderWithI18n(<UnifiedFileSearch searchInput="report" onSearchInputChange={vi.fn()} onFilenameSearch={onSearch} />, { locale: "en" });
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(screen.getByRole("button", { name: "Filename" }));
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onSearch).toHaveBeenCalledWith("current");
    await act(async () => pending.resolve(new Response(JSON.stringify({ results: [{ nodeId: "n1", relativePath: "stale.txt", snippets: ["stale content"] }], truncated: false, totalMatches: 1 }), { headers: { "Content-Type": "application/json" } })));
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    expect(screen.queryByText("stale content")).not.toBeInTheDocument();
  });

  it("aborts a pending request on unmount", () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = renderWithI18n(<UnifiedFileSearch searchInput="report" onSearchInputChange={vi.fn()} onFilenameSearch={vi.fn()} />, { locale: "en" });
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    unmount();
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
  });

  it("aborts the previous content search and keeps the newest result", async () => {
    const first = deferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => {
        init?.signal?.addEventListener("abort", () => first.resolve(new Response(null, { status: 499 })));
        return first.promise;
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ filePath: "new.txt", relativePath: "new.txt", nodeId: "n1", nodeName: "Node", nodeDriver: "LOCAL", snippets: ["new hit"] }],
        totalMatches: 1,
        truncated: false,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    function Harness() {
      const [query, setQuery] = useState("old");
      return <UnifiedFileSearch searchInput={query} onSearchInputChange={setQuery} onFilenameSearch={vi.fn()} />;
    }

    renderWithI18n(<Harness />, { locale: "en" });
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "new" } });
    fireEvent.submit(screen.getByLabelText("Content").closest("form")!);

    expect(await screen.findByText("new hit")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(firstSignal.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByText("old")).not.toBeInTheDocument());
  });
});
