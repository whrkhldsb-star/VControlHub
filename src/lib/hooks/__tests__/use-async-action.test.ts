import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useAsyncAction } from "@/lib/hooks/use-async-action";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => { resolve = ok; });
  return { promise, resolve };
}

describe("useAsyncAction", () => {
  it("tracks the active action key and returns the result", async () => {
    const pending = deferred<number>();
    const { result } = renderHook(() => useAsyncAction());
    let execution!: Promise<number | undefined>;
    act(() => { execution = result.current.run("save", () => pending.promise, { fallback: "Save failed" }); });
    expect(result.current.busyKey).toBe("save");
    await act(async () => { pending.resolve(42); await execution; });
    expect(result.current.busyKey).toBeNull();
    expect(await execution).toBe(42);
  });

  it("maps failures and clears a prior error before the next run", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => { await result.current.run("first", async () => { throw new Error("boom"); }, { fallback: "fallback" }); });
    expect(result.current.error).toBe("boom");
    await act(async () => { await result.current.run("second", async () => "ok", { fallback: "fallback" }); });
    expect(result.current.error).toBeNull();
  });

  it("supports manual error dismissal", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => { await result.current.run("x", async () => { throw new Error("failed"); }, { fallback: "fallback" }); });
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("rejects synchronous re-entry while an action is still running", async () => {
    const pending = deferred<string>();
    const { result } = renderHook(() => useAsyncAction());
    let first!: Promise<string | undefined>;
    let second!: Promise<string | undefined>;

    act(() => {
      first = result.current.run("first", () => pending.promise, { fallback: "failed" });
      second = result.current.run("second", async () => "unexpected", { fallback: "failed" });
    });

    await expect(second).resolves.toBeUndefined();
    expect(result.current.busyKey).toBe("first");
    await act(async () => {
      pending.resolve("done");
      await first;
    });
    await expect(first).resolves.toBe("done");
    expect(result.current.busyKey).toBeNull();
  });
});
