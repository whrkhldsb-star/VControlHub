import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";

import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";

function makeButton(label: string) {
  const btn = document.createElement("button");
  btn.textContent = label;
  return btn;
}

function makeInput() {
  return document.createElement("input");
}

describe("useDialogFocus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("returns a stable ref bound to the dialog element", () => {
    const { result } = renderHook(() => useDialogFocus({ open: false, onClose: () => {} }));
    expect(result.current).toBeDefined();
    expect(result.current.current).toBeNull();
  });

  it("focuses the initialFocusRef element when the dialog opens", () => {
    const container = document.createElement("div");
    const trigger = makeButton("trigger");
    const input1 = makeInput();
    const input2 = makeInput();
    container.append(trigger, input1, input2);
    document.body.append(container);

    const onClose = vi.fn();
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => {
        const initialFocusRef = useRef<HTMLElement | null>(null);
        initialFocusRef.current = input2;
        return useDialogFocus({ open, onClose, initialFocusRef });
      },
      { initialProps: { open: false } },
    );

    // Mount the dialog element into the DOM.
    act(() => {
      container.id = "dialog";
      result.current.current = container;
    });
    rerender({ open: true });
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(input2);
  });

  it("Escape key invokes onClose", () => {
    const container = document.createElement("div");
    const closeBtn = makeButton("x");
    container.append(closeBtn);
    document.body.append(container);

    const onClose = vi.fn();
    const { result } = renderHook(() => useDialogFocus({ open: true, onClose }));
    act(() => {
      result.current.current = container;
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Tab on the last focusable element wraps to the first", () => {
    const container = document.createElement("div");
    const a = makeButton("a");
    const b = makeButton("b");
    container.append(a, b);
    document.body.append(container);

    const { result } = renderHook(() => useDialogFocus({ open: true, onClose: () => {} }));
    act(() => {
      result.current.current = container;
      b.focus();
    });
    expect(document.activeElement).toBe(b);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    });
    expect(document.activeElement).toBe(a);
  });

  it("Shift+Tab on the first focusable element wraps to the last", () => {
    const container = document.createElement("div");
    const a = makeButton("a");
    const b = makeButton("b");
    container.append(a, b);
    document.body.append(container);

    const { result } = renderHook(() => useDialogFocus({ open: true, onClose: () => {} }));
    act(() => {
      result.current.current = container;
      a.focus();
    });
    expect(document.activeElement).toBe(a);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
    });
    expect(document.activeElement).toBe(b);
  });

  it("does not bind the keydown handler when open=false", () => {
    const onClose = vi.fn();
    renderHook(() => useDialogFocus({ open: false, onClose }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
