import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useActionResultToast } from "../use-action-result-toast";
import type { ActionResult } from "../action-result";
import type { ReactNode } from "react";

// Mock toast-provider 模块
const addToastMock = vi.fn();
vi.mock("@/components/toast-provider", () => ({
  useToast: () => ({ addToast: addToastMock, toasts: [], removeToast: vi.fn() }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return children as React.ReactElement;
}

describe("useActionResultToast", () => {
  beforeEach(() => {
    addToastMock.mockClear();
  });

  it("shows success toast on success and returns true", () => {
    const { result } = renderHook(() => useActionResultToast(), { wrapper });
    let returned = false;
    act(() => {
      const r: ActionResult = { ok: true, message: "Saved" };
      returned = result.current(r);
    });
    expect(returned).toBe(true);
    expect(addToastMock).toHaveBeenCalledWith("success", "Saved");
  });

  it("uses successMessage default when no message", () => {
    const { result } = renderHook(() => useActionResultToast({ successMessage: "Created" }), {
      wrapper,
    });
    act(() => {
      result.current({ ok: true });
    });
    expect(addToastMock).toHaveBeenCalledWith("success", "Created");
  });

  it("showSuccess=false suppresses toast on success", () => {
    const { result } = renderHook(() => useActionResultToast({ showSuccess: false }), {
      wrapper,
    });
    let returned = false;
    act(() => {
      returned = result.current({ ok: true, message: "ignored" });
    });
    expect(returned).toBe(true);
    expect(addToastMock).not.toHaveBeenCalled();
  });

  it("perCall option overrides defaults", () => {
    const { result } = renderHook(() => useActionResultToast({ showSuccess: true }), { wrapper });
    act(() => {
      result.current({ ok: true }, { showSuccess: false });
    });
    expect(addToastMock).not.toHaveBeenCalled();
  });

  it("shows error toast on failure and returns false", () => {
    const { result } = renderHook(() => useActionResultToast(), { wrapper });
    let returned = true;
    act(() => {
      returned = result.current({ ok: false, code: "FORBIDDEN", message: "No permission" });
    });
    expect(returned).toBe(false);
    expect(addToastMock).toHaveBeenCalledWith("error", "No permission");
  });

  it("RATE_LIMITED uses warning instead of error", () => {
    const { result } = renderHook(() => useActionResultToast(), { wrapper });
    act(() => {
      result.current({ ok: false, code: "RATE_LIMITED", message: "Too many requests" });
    });
    expect(addToastMock).toHaveBeenCalledWith("warning", "Too many requests");
  });

  it("PARTIAL_FAILURE appends X/Y failure summary", () => {
    const { result } = renderHook(() => useActionResultToast(), { wrapper });
    act(() => {
      result.current({
        ok: false,
        code: "PARTIAL_FAILURE",
        message: "Partial operation failure",
        partial: [
          { id: "a", ok: true },
          { id: "b", ok: false },
          { id: "c", ok: false },
        ],
      });
    });
    expect(addToastMock).toHaveBeenCalledWith("warning", "Partial operation failure (2/3 failed)");
  });

  it("VALIDATION_FAILED appends first field error", () => {
    const { result } = renderHook(() => useActionResultToast(), { wrapper });
    act(() => {
      result.current({
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Input error",
        details: { name: ["cannot be empty"], email: ["invalid format"] },
      });
    });
    expect(addToastMock).toHaveBeenCalledWith("error", "Input error: cannot be empty");
  });

  it("VALIDATION_FAILED without details shows only message", () => {
    const { result } = renderHook(() => useActionResultToast(), { wrapper });
    act(() => {
      result.current({ ok: false, code: "VALIDATION_FAILED", message: "Validation failed" });
    });
    expect(addToastMock).toHaveBeenCalledWith("error", "Validation failed");
  });
});
