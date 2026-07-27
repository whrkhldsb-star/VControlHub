import { useState } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { UnifiedFileSearch } from "../unified-file-search";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("UnifiedFileSearch request lifecycle", () => {
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
