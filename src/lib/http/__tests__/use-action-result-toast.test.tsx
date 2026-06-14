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

  it("成功时显示 success toast 并返回 true", () => {
    const { result } = renderHook(() => useActionResultToast(), { wrapper });
    let returned = false;
    act(() => {
      const r: ActionResult = { ok: true, message: "已保存" };
      returned = result.current(r);
    });
    expect(returned).toBe(true);
    expect(addToastMock).toHaveBeenCalledWith("success", "已保存");
  });

  it("成功时无 message 用 successMessage 默认值", () => {
    const { result } = renderHook(() => useActionResultToast({ successMessage: "已创建" }), {
      wrapper,
    });
    act(() => {
      result.current({ ok: true });
    });
    expect(addToastMock).toHaveBeenCalledWith("success", "已创建");
  });

  it("成功时 showSuccess=false 不显示 toast", () => {
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

  it("perCall 选项覆盖 defaults", () => {
    const { result } = renderHook(() => useActionResultToast({ showSuccess: true }), { wrapper });
    act(() => {
      result.current({ ok: true }, { showSuccess: false });
    });
    expect(addToastMock).not.toHaveBeenCalled();
  });

  it("失败时显示 error toast 并返回 false", () => {
    const { result } = renderHook(() => useActionResultToast(), { wrapper });
    let returned = true;
    act(() => {
      returned = result.current({ ok: false, code: "FORBIDDEN", message: "无权限" });
    });
    expect(returned).toBe(false);
    expect(addToastMock).toHaveBeenCalledWith("error", "无权限");
  });

  it("RATE_LIMITED 用 warning 而非 error", () => {
    const { result } = renderHook(() => useActionResultToast(), { wrapper });
    act(() => {
      result.current({ ok: false, code: "RATE_LIMITED", message: "请求过多" });
    });
    expect(addToastMock).toHaveBeenCalledWith("warning", "请求过多");
  });

  it("PARTIAL_FAILURE 附加 X/Y 失败摘要", () => {
    const { result } = renderHook(() => useActionResultToast(), { wrapper });
    act(() => {
      result.current({
        ok: false,
        code: "PARTIAL_FAILURE",
        message: "批量操作部分失败",
        partial: [
          { id: "a", ok: true },
          { id: "b", ok: false },
          { id: "c", ok: false },
        ],
      });
    });
    expect(addToastMock).toHaveBeenCalledWith("warning", "批量操作部分失败（2/3 失败）");
  });

  it("VALIDATION_FAILED 附加首个字段错误", () => {
    const { result } = renderHook(() => useActionResultToast(), { wrapper });
    act(() => {
      result.current({
        ok: false,
        code: "VALIDATION_FAILED",
        message: "输入有误",
        details: { name: ["不能为空"], email: ["格式错"] },
      });
    });
    expect(addToastMock).toHaveBeenCalledWith("error", "输入有误：不能为空");
  });

  it("VALIDATION_FAILED 无 details 时只显示 message", () => {
    const { result } = renderHook(() => useActionResultToast(), { wrapper });
    act(() => {
      result.current({ ok: false, code: "VALIDATION_FAILED", message: "校验失败" });
    });
    expect(addToastMock).toHaveBeenCalledWith("error", "校验失败");
  });
});
