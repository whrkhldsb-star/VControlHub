import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAbortableTextResource } from "@/lib/http/use-abortable-text-resource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("useAbortableTextResource", () => {
  it("aborts an obsolete request when the URL changes", async () => {
    const first = deferred<Response>();
    const fetcher = vi.fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => {
        init?.signal?.addEventListener("abort", () => first.resolve(new Response(null, { status: 499 })));
        return first.promise;
      })
      .mockResolvedValueOnce(new Response("new content", { status: 200 }));

    const { result, rerender } = renderHook(
      ({ href }) => useAbortableTextResource({ href, fetcher }),
      { initialProps: { href: "/old" } },
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    rerender({ href: "/new" });

    await waitFor(() => expect(result.current.content).toBe("new content"));
    expect((fetcher.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it("can retry the current URL after a failure", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("recovered", { status: 200 }));
    const getStatusError = (status: number) => `status ${status}`;
    const { result } = renderHook(() => useAbortableTextResource({
      href: "/file",
      fetcher,
      errorMessage: getStatusError,
    }));

    await waitFor(() => expect(result.current.error).toBe("status 503"));
    await act(() => result.current.reload());
    expect(result.current.content).toBe("recovered");
  });

  it("does not reload when callback identities change during a render", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("stable", { status: 200 }));
    const { result, rerender } = renderHook(
      ({ renderId }) => useAbortableTextResource({
        href: "/file",
        fetcher,
        errorMessage: (status) => `${renderId}: status ${status}`,
        getErrorMessage: () => `${renderId}: failed`,
      }),
      { initialProps: { renderId: 1 } },
    );

    await waitFor(() => expect(result.current.content).toBe("stable"));
    rerender({ renderId: 2 });
    await act(async () => { await Promise.resolve(); });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.content).toBe("stable");
  });

  it("invokes the fetcher as a standalone function", async () => {
    const fetcherMock = vi.fn(function (this: unknown) {
      return Promise.resolve(new Response("content", { status: 200 }));
    });
    const fetcher = fetcherMock as unknown as typeof fetch;

    const { result } = renderHook(() => useAbortableTextResource({
      href: "/file",
      fetcher,
    }));

    await waitFor(() => expect(result.current.content).toBe("content"));
    expect(fetcherMock.mock.contexts[0]).toBeUndefined();
  });
});
