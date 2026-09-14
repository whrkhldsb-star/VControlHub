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

  it("Escape does not close when closeLocked", () => {
    const container = document.createElement("div");
    container.append(makeButton("x"));
    document.body.append(container);

    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useDialogFocus({ open: true, onClose, closeLocked: true }),
    );
    act(() => {
      result.current.current = container;
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).not.toHaveBeenCalled();
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

  it("ignores controls inside hidden and disabled containers", () => {
    const container = document.createElement("div");
    const hidden = document.createElement("div");
    hidden.style.display = "none";
    hidden.append(makeButton("hidden"));
    const fieldset = document.createElement("fieldset");
    fieldset.disabled = true;
    fieldset.append(makeInput());
    const visible = makeButton("visible");
    container.append(hidden, fieldset, visible);
    document.body.append(container);
    const { result } = renderHook(() => useDialogFocus({open:true,onClose:vi.fn()}));
    act(() => { result.current.current = container; vi.runAllTimers(); });
    expect(visible).toHaveFocus();
  });

  it("recaptures tab navigation when focus escaped the dialog", () => {
    const outside = makeButton("outside");
    const container = document.createElement("div");
    const inside = makeButton("inside");
    container.append(inside);
    document.body.append(outside, container);
    const { result } = renderHook(() => useDialogFocus({open:true,onClose:vi.fn()}));
    act(() => {
      result.current.current = container;
      outside.focus();
      window.dispatchEvent(new KeyboardEvent("keydown", {key:"Tab"}));
    });
    expect(inside).toHaveFocus();
  });

  it("only dismisses the top dialog and restores scrolling after the last closes", () => {
    document.body.style.overflow = "auto";
    const parent = document.createElement("div");
    const child = document.createElement("div");
    const parentClose = vi.fn();
    const childClose = vi.fn();
    document.body.append(parent, child);
    const first = renderHook(() => useDialogFocus({open:true,onClose:parentClose}));
    const second = renderHook(() => useDialogFocus({open:true,onClose:childClose}));
    act(() => {
      first.result.current.current = parent;
      second.result.current.current = child;
      window.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape"}));
    });
    expect(parentClose).not.toHaveBeenCalled();
    expect(childClose).toHaveBeenCalledOnce();
    expect(document.body.style.overflow).toBe("hidden");
    second.unmount();
    expect(document.body.style.overflow).toBe("hidden");
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape"})); });
    expect(parentClose).toHaveBeenCalledOnce();
    first.unmount();
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });
});
