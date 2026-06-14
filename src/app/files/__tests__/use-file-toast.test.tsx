import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFileToast } from "../use-file-toast";

describe("useFileToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with an empty toast list", () => {
    const { result } = renderHook(() => useFileToast());
    expect(result.current.toasts).toEqual([]);
  });

  it("appends a toast with the requested type and message", () => {
    const { result } = renderHook(() => useFileToast());
    act(() => {
      result.current.showToast("success", "saved");
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]!.type).toBe("success");
    expect(result.current.toasts[0]!.message).toBe("saved");
    expect(typeof result.current.toasts[0]!.id).toBe("number");
  });

  it("caps the visible window at 3 toasts (FIFO)", () => {
    const { result } = renderHook(() => useFileToast());
    act(() => {
      result.current.showToast("info", "1");
      result.current.showToast("info", "2");
      result.current.showToast("info", "3");
      result.current.showToast("info", "4");
    });
    expect(result.current.toasts.map((t) => t.message)).toEqual([
      "2",
      "3",
      "4",
    ]);
  });

  it("auto-dismisses a toast after 3.8s", () => {
    const { result } = renderHook(() => useFileToast());
    act(() => {
      result.current.showToast("info", "vanish");
    });
    expect(result.current.toasts).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(3800);
    });
    expect(result.current.toasts).toEqual([]);
  });

  it("dismisses a specific toast on demand", () => {
    const { result } = renderHook(() => useFileToast());
    act(() => {
      result.current.showToast("error", "x");
    });
    const id = result.current.toasts[0]!.id;
    act(() => {
      result.current.dismissToast(id);
    });
    expect(result.current.toasts).toEqual([]);
  });
});
