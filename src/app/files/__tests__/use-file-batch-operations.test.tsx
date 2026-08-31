import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the three batch-operation hooks behind the file list toolbar.
 *
 * The move flow had no tests of its own. The property worth pinning is what
 * happens on a *partial* failure: all three hooks return `batchAction` to
 * `"none"`, dropping back to the selection toolbar with the attempted files
 * re-selected and the per-file errors still listed. Retry is reachable because
 * the toolbar's "batch move" button resets `moveProgress` when it reopens the
 * panel — so the confirm button's `moveProgress.done > 0` guard only blocks an
 * immediate duplicate submit inside one open panel, never a fresh attempt.
 *
 * That interplay is easy to break from either side (stop resetting on open, or
 * stop restoring the selection), and it is only correct as a pair, so the
 * disable expression is mirrored here and asserted against both paths.
 */
const mocks = vi.hoisted(() => ({
	deleteFileEntryAction: vi.fn(),
	moveFileAction: vi.fn(),
	csrfFetch: vi.fn(),
}));

vi.mock("../../storage/actions", () => ({ deleteFileEntryAction: mocks.deleteFileEntryAction }));
vi.mock("../move-file-action", () => ({ moveFileAction: mocks.moveFileAction }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.csrfFetch }));

import { useBatchCompress, useBatchDelete, useBatchMove } from "../use-file-batch-operations";

type Progress = { done: number; total: number; errors: string[] };

function harness(overrides: Record<string, unknown> = {}) {
	const state = {
		batchAction: "none" as string,
		progress: { done: 0, total: 0, errors: [] } as Progress,
		moveProgress: { done: 0, total: 0, errors: [] } as Progress,
		selectedIds: new Set<string>(),
		scopeKey: "",
		toasts: [] as Array<{ type: string; message: string }>,
		refreshed: 0,
	};
	const input = {
		effectiveSelectedIds: ["f1", "f2"] as readonly string[],
		files: [
			{ id: "f1", name: "a.txt", relativePath: "dir/a.txt", storageNodeId: "n1", storageNodeDriver: "LOCAL" },
			{ id: "f2", name: "b.txt", relativePath: "dir/b.txt", storageNodeId: "n1", storageNodeDriver: "LOCAL" },
		] as never,
		router: { refresh: () => { state.refreshed += 1; } } as never,
		clearSelection: () => { state.selectedIds = new Set(); state.batchAction = "none"; },
		onRefresh: undefined,
		currentSelectionScopeKey: "scope-1",
		showToast: (type: "success" | "error" | "info", message: string) => { state.toasts.push({ type, message }); },
		t: (key: string) => key,
		setBatchAction: (a: string) => { state.batchAction = a; },
		setProgress: (p: Progress) => { state.progress = p; },
		setMoveProgress: (p: Progress) => { state.moveProgress = p; },
		setSelectedIds: (ids: Set<string>) => { state.selectedIds = ids; },
		setSelectedScopeKey: (k: string) => { state.scopeKey = k; },
		startTransition: (fn: () => void | Promise<void>) => { void fn(); },
		moveTargetDir: "target",
		currentPath: "dir",
		...overrides,
	};
	return { state, input };
}

/** The toolbar's own disable expression, kept in sync with file-batch-toolbar.tsx. */
function confirmMoveDisabled(moveTargetDir: string, isPending: boolean, moveProgress: Progress) {
	return !moveTargetDir.trim() || isPending || moveProgress.done > 0;
}

describe("useBatchMove", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.moveFileAction.mockReset();
		mocks.moveFileAction.mockResolvedValue(null);
	});

	it("moves every selected file with its own path and node", async () => {
		const { state, input } = harness();
		const { result } = renderHook(() => useBatchMove(input as never));
		await act(async () => { result.current(); });
		expect(mocks.moveFileAction).toHaveBeenCalledTimes(2);
		const first = mocks.moveFileAction.mock.calls[0]![1] as FormData;
		expect(first.get("fileEntryId")).toBe("f1");
		expect(first.get("targetDir")).toBe("target");
		expect(first.get("currentRelativePath")).toBe("dir/a.txt");
		expect(first.get("storageNodeId")).toBe("n1");
		expect(state.toasts.at(-1)).toMatchObject({ type: "success" });
	});

	it("is a no-op without a target directory", async () => {
		const { input } = harness({ moveTargetDir: "   " });
		const { result } = renderHook(() => useBatchMove(input as never));
		await act(async () => { result.current(); });
		expect(mocks.moveFileAction).not.toHaveBeenCalled();
	});

	it("is a no-op with an empty selection", async () => {
		const { input } = harness({ effectiveSelectedIds: [] });
		const { result } = renderHook(() => useBatchMove(input as never));
		await act(async () => { result.current(); });
		expect(mocks.moveFileAction).not.toHaveBeenCalled();
	});

	it("returns to the selection toolbar after a partial failure, re-selecting the attempted files", async () => {
		// Closing the panel is intentional: the errors are rendered by the toolbar's
		// own summary, and the files stay selected so the user can retry.
		mocks.moveFileAction
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ error: "target is in the recycle bin" });
		const { state, input } = harness();
		state.batchAction = "moving";
		const { result } = renderHook(() => useBatchMove(input as never));
		await act(async () => { result.current(); });
		expect(state.batchAction).toBe("none");
		expect(state.moveProgress.errors).toHaveLength(1);
		// `done` counts *attempts*, not successes — 2/2 with one error listed. The
		// error list, not the counter, is what reports the failures.
		expect(state.moveProgress).toMatchObject({ done: 2, total: 2 });
		expect([...state.selectedIds]).toEqual(["f1", "f2"]);
		expect(state.scopeKey).toBe("scope-1");
	});

	it("stays retryable after a partial failure once the panel is reopened", async () => {
		// Reopening resets moveProgress (see the "batch move" button in
		// file-batch-toolbar.tsx), which is what keeps the confirm button live.
		// Without that reset the `done > 0` guard would be a permanent dead end.
		mocks.moveFileAction
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ error: "boom" });
		const { state, input } = harness();
		const { result } = renderHook(() => useBatchMove(input as never));
		await act(async () => { result.current(); });
		// Inside the still-open panel a duplicate submit is blocked...
		expect(confirmMoveDisabled("target", false, state.moveProgress)).toBe(true);
		// ...and reopening the panel clears the counter, so retry is available.
		const reopened = { done: 0, total: 0, errors: [] };
		expect(confirmMoveDisabled("target", false, reopened)).toBe(false);
	});

	it("still disables confirm after a fully successful move", async () => {
		// A clean run must not invite an immediate duplicate submit.
		const { state, input } = harness();
		const { result } = renderHook(() => useBatchMove(input as never));
		await act(async () => { result.current(); });
		// clearSelection() ran, so progress is what the hook last reported.
		expect(confirmMoveDisabled("target", false, { done: 2, total: 2, errors: [] })).toBe(true);
		expect(state.toasts.at(-1)).toMatchObject({ type: "success" });
	});

	it("reports accurate progress rather than resetting the counter", async () => {
		mocks.moveFileAction
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ error: "boom" });
		const { state, input } = harness();
		const { result } = renderHook(() => useBatchMove(input as never));
		await act(async () => { result.current(); });
		expect(state.moveProgress.done).toBe(2);
		expect(state.moveProgress.total).toBe(2);
	});

	it("records a missing file as an error instead of silently skipping it", async () => {
		const { state, input } = harness({ effectiveSelectedIds: ["f1", "ghost"] });
		const { result } = renderHook(() => useBatchMove(input as never));
		await act(async () => { result.current(); });
		expect(mocks.moveFileAction).toHaveBeenCalledTimes(1);
		expect(state.moveProgress.errors).toHaveLength(1);
	});

	it("refreshes the listing even when some moves failed", async () => {
		mocks.moveFileAction.mockResolvedValue({ error: "boom" });
		const { state, input } = harness();
		const { result } = renderHook(() => useBatchMove(input as never));
		await act(async () => { result.current(); });
		// The successful ones have already left the directory; a stale list would
		// still show them.
		expect(state.refreshed).toBe(1);
	});
});

describe("useBatchDelete", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.deleteFileEntryAction.mockReset();
		mocks.deleteFileEntryAction.mockResolvedValue(null);
	});

	it("deletes each selected id and clears the selection on success", async () => {
		const { state, input } = harness();
		const { result } = renderHook(() => useBatchDelete(input as never));
		await act(async () => { result.current(); });
		expect(mocks.deleteFileEntryAction).toHaveBeenCalledTimes(2);
		expect(state.selectedIds.size).toBe(0);
		expect(state.toasts.at(-1)).toMatchObject({ type: "success" });
	});

	it("returns to the selection toolbar on partial failure, which is its retry path", async () => {
		// Unlike move, delete owns no panel — "none" *is* where retry lives.
		mocks.deleteFileEntryAction
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ error: "permission denied" });
		const { state, input } = harness();
		const { result } = renderHook(() => useBatchDelete(input as never));
		await act(async () => { result.current(); });
		expect(state.batchAction).toBe("none");
		expect([...state.selectedIds]).toEqual(["f1", "f2"]);
		expect(state.progress.errors).toHaveLength(1);
	});

	it("names the failing file in the error rather than only its id", async () => {
		mocks.deleteFileEntryAction.mockResolvedValueOnce({ error: "locked" });
		const { state, input } = harness({ effectiveSelectedIds: ["f1"] });
		const { result } = renderHook(() => useBatchDelete(input as never));
		await act(async () => { result.current(); });
		expect(state.progress.errors[0]).toContain("a.txt");
	});
});

describe("useBatchCompress", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.csrfFetch.mockReset();
		mocks.csrfFetch.mockResolvedValue({ message: "done" });
	});

	it("posts the selected relative paths for a single-node selection", async () => {
		const { input } = harness();
		const { result } = renderHook(() => useBatchCompress(input as never));
		await act(async () => { result.current(); });
		const body = JSON.parse((mocks.csrfFetch.mock.calls[0]![1] as { body: string }).body);
		expect(body.storageNodeId).toBe("n1");
		expect(body.relativePaths).toEqual(["dir/a.txt", "dir/b.txt"]);
		expect(body.targetDir).toBe("dir");
	});

	it("refuses a selection spanning two storage nodes", async () => {
		// The API writes the archive into one mount; a cross-node request is a
		// guaranteed 400.
		const { state, input } = harness();
		(input.files as unknown as Array<{ storageNodeId: string }>)[1]!.storageNodeId = "n2";
		const { result } = renderHook(() => useBatchCompress(input as never));
		await act(async () => { result.current(); });
		expect(mocks.csrfFetch).not.toHaveBeenCalled();
		expect(state.toasts.at(-1)).toMatchObject({ type: "error" });
	});

	it("refuses a non-LOCAL selection because server compress shells out to tar", async () => {
		const { state, input } = harness();
		(input.files as unknown as Array<{ storageNodeDriver: string }>)[1]!.storageNodeDriver = "SFTP";
		const { result } = renderHook(() => useBatchCompress(input as never));
		await act(async () => { result.current(); });
		expect(mocks.csrfFetch).not.toHaveBeenCalled();
		expect(state.toasts.at(-1)).toMatchObject({ type: "error" });
	});

	it("surfaces a server-side failure and keeps the selection for retry", async () => {
		mocks.csrfFetch.mockRejectedValue(new Error("disk full"));
		const { state, input } = harness();
		const { result } = renderHook(() => useBatchCompress(input as never));
		await act(async () => { result.current(); });
		expect(state.batchAction).toBe("none");
		expect([...state.selectedIds]).toEqual(["f1", "f2"]);
		expect(state.progress.errors[0]).toContain("disk full");
	});

	it("treats an { error } payload as a failure even on a 200", async () => {
		mocks.csrfFetch.mockResolvedValue({ error: "archive already exists" });
		const { state, input } = harness();
		const { result } = renderHook(() => useBatchCompress(input as never));
		await act(async () => { result.current(); });
		expect(state.toasts.at(-1)).toMatchObject({ type: "error" });
	});
});
