import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the batch-compress hook behind the file list toolbar (the batch
 * delete/move hooks were dead code and are gone, A4-35).
 *
 * The move flow had no tests of its own. The property worth pinning is what
 * happens on a *partial* failure: all three hooks return `batchAction` to
 * `"none"`, dropping back to the selection toolbar with the attempted files
 * filtered to failures and the per-file errors still listed. Retry is reachable because
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

import { useBatchCompress } from "../use-file-batch-operations";

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

	it("lets the server use the files' own folder in the all-locations view", async () => {
		// The all-locations path is virtual ("Node__id/dir"); sent as the
		// target, the server created it as a real folder on the node.
		const { input } = harness({ currentPath: undefined });
		const { result } = renderHook(() => useBatchCompress(input as never));
		await act(async () => { result.current(); });
		const body = JSON.parse((mocks.csrfFetch.mock.calls[0]![1] as { body: string }).body);
		expect(body).not.toHaveProperty("targetDir");
		expect(body.relativePaths).toEqual(["dir/a.txt", "dir/b.txt"]);
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
