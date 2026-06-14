import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useFileSelection } from "../use-file-selection";

describe("useFileSelection", () => {
  it("starts with empty selection and no batch action", () => {
    const { result } = renderHook(() =>
      useFileSelection({ currentSelectionScopeKey: "scope-1" }),
    );
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.batchAction).toBe("none");
    expect(result.current.selectedScopeMatches).toBe(true);
  });

  it("toggleOne adds an id to the selection", () => {
    const { result } = renderHook(() =>
      useFileSelection({ currentSelectionScopeKey: "scope-1" }),
    );
    act(() => {
      result.current.toggleOne("a");
    });
    expect(result.current.selectedIds.has("a")).toBe(true);
    expect(result.current.selectedIds.size).toBe(1);
  });

  it("toggleOne removes an id if already selected", () => {
    const { result } = renderHook(() =>
      useFileSelection({ currentSelectionScopeKey: "scope-1" }),
    );
    act(() => {
      result.current.toggleOne("a");
      result.current.toggleOne("a");
    });
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("toggleAll selects every id when not all selected", () => {
    const { result } = renderHook(() =>
      useFileSelection({ currentSelectionScopeKey: "scope-1" }),
    );
    act(() => {
      result.current.toggleAll(["a", "b", "c"], false);
    });
    expect(result.current.selectedIds.size).toBe(3);
    expect([...result.current.selectedIds].sort()).toEqual(["a", "b", "c"]);
  });

  it("toggleAll clears the selection when all selected", () => {
    const { result } = renderHook(() =>
      useFileSelection({ currentSelectionScopeKey: "scope-1" }),
    );
    act(() => {
      result.current.toggleAll(["a", "b"], false);
      result.current.toggleAll(["a", "b"], true);
    });
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("clearSelection empties the selection and resets batch state", () => {
    const { result } = renderHook(() =>
      useFileSelection({ currentSelectionScopeKey: "scope-1" }),
    );
    act(() => {
      result.current.toggleOne("a");
      result.current.setBatchAction("deleting");
      result.current.clearSelection();
    });
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.batchAction).toBe("none");
  });

  it("selectedScopeMatches is false after the scope key changes externally", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useFileSelection({ currentSelectionScopeKey: key }),
      { initialProps: { key: "scope-1" } },
    );
    act(() => {
      result.current.toggleOne("a");
    });
    expect(result.current.selectedScopeMatches).toBe(true);
    rerender({ key: "scope-2" });
    expect(result.current.selectedScopeMatches).toBe(false);
  });

  it("toggleOne after a scope change re-aligns the scope to current", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useFileSelection({ currentSelectionScopeKey: key }),
      { initialProps: { key: "scope-1" } },
    );
    act(() => {
      result.current.toggleOne("a");
    });
    expect(result.current.selectedScopeMatches).toBe(true);
    rerender({ key: "scope-2" });
    // Without any user action yet, the stored scope key is still the old
    // one — so the selection is now stale relative to the visible set.
    expect(result.current.selectedScopeMatches).toBe(false);
    act(() => {
      result.current.toggleOne("b");
    });
    // toggleOne re-aligns the scope key to the current value, marking
    // the in-flight selection as applicable again.
    expect(result.current.selectedScopeMatches).toBe(true);
    expect(result.current.selectedIds.has("b")).toBe(true);
  });
});
