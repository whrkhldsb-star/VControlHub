import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `useImageBedActions`.
 *
 * The bug these were written against: the upload album was taken from the page's
 * **search box**. `q` is a substring query matched against filename,
 * relativePath *and* album (see `/api/images/list`), so after searching for
 * "cover" every subsequent upload was filed into an album literally named
 * "cover" — silently, with no field on screen saying so. The album now comes
 * from `publishForm.album`, which has its own input.
 *
 * Beyond that, the destructive paths get the attention: batch delete must refuse
 * an empty selection, must not fire twice on a double click, and a failed single
 * delete must leave the dialog dismissible rather than wedging `deleting`.
 */
const mocks = vi.hoisted(() => ({ csrfFetch: vi.fn() }));

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.csrfFetch }));

import { useImageBedActions } from "../use-image-bed-actions";

function setup(overrides: Record<string, unknown> = {}) {
	const state = { fetched: [] as number[] };
	const args = {
		t: (key: string) => key,
		search: "",
		page: 1,
		showAll: false,
		images: [
			{ id: "img_1", filename: "cover.jpg", publicUrl: "/i/1", album: "photos" },
			{ id: "img_2", filename: "banner.png", publicUrl: "/i/2", album: "photos" },
		] as never,
		fetchImages: (p = 1) => { state.fetched.push(p); },
		...overrides,
	};
	return { state, args };
}

function imageFile(name = "a.png") {
	return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

/** FileList-ish object accepted by handleUpload. */
function fileList(files: File[]) {
	// `handleUpload` iterates with Array.from, so index keys plus `length` and
	// `item` are enough. Spread first so the explicit `length` wins.
	return {
		...files,
		length: files.length,
		item: (i: number) => files[i] ?? null,
	} as unknown as FileList;
}

describe("useImageBedActions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.csrfFetch.mockReset();
		mocks.csrfFetch.mockResolvedValue({});
	});

	afterEach(() => {
		// `showToast` schedules an unguarded `setTimeout(..., 3000)` to clear the
		// toast, so every test that surfaces one leaves a pending timer that fires
		// against an unmounted hook and makes a *later* test's `result.current`
		// read as null. Unmount and drain before moving on.
		cleanup();
		vi.clearAllTimers();
	});

	describe("upload album", () => {
		it("does not use the search text as the album", async () => {
			// The regression: searching "cover" then uploading filed the image into
			// an album called "cover".
			const { args } = setup({ search: "cover" });
			const { result } = renderHook(() => useImageBedActions(args as never));
			await act(async () => { await result.current.handleUpload(fileList([imageFile()])); });
			const call = mocks.csrfFetch.mock.calls.find((c) => c[0] === "/api/images/upload");
			const body = call![1].body as FormData;
			expect(body.get("album")).toBeNull();
		});

		it("uses the dedicated album field when one is set", async () => {
			const { args } = setup({ search: "cover" });
			const { result } = renderHook(() => useImageBedActions(args as never));
			act(() => { result.current.setPublishForm((pf) => ({ ...pf, album: "  vacation  " })); });
			await act(async () => { await result.current.handleUpload(fileList([imageFile()])); });
			const call = mocks.csrfFetch.mock.calls.find((c) => c[0] === "/api/images/upload");
			expect((call![1].body as FormData).get("album")).toBe("vacation");
		});

		it("omits a whitespace-only album rather than creating one named ' '", async () => {
			const { args } = setup();
			const { result } = renderHook(() => useImageBedActions(args as never));
			act(() => { result.current.setPublishForm((pf) => ({ ...pf, album: "   " })); });
			await act(async () => { await result.current.handleUpload(fileList([imageFile()])); });
			const call = mocks.csrfFetch.mock.calls.find((c) => c[0] === "/api/images/upload");
			expect((call![1].body as FormData).get("album")).toBeNull();
		});

		it("forwards the storage node and relative path when set", async () => {
			const { args } = setup();
			const { result } = renderHook(() => useImageBedActions(args as never));
			act(() => {
				result.current.setPublishForm((pf) => ({ ...pf, storageNodeId: "node_1", relativePath: "img/2026" }));
			});
			await act(async () => { await result.current.handleUpload(fileList([imageFile()])); });
			const body = mocks.csrfFetch.mock.calls.find((c) => c[0] === "/api/images/upload")![1].body as FormData;
			expect(body.get("storageNodeId")).toBe("node_1");
			expect(body.get("relativePath")).toBe("img/2026");
		});

		it("rejects a non-image without calling the API", async () => {
			const { args } = setup();
			const { result } = renderHook(() => useImageBedActions(args as never));
			const notImage = new File(["x"], "notes.txt", { type: "text/plain" });
			await act(async () => { await result.current.handleUpload(fileList([notImage])); });
			expect(mocks.csrfFetch.mock.calls.filter((c) => c[0] === "/api/images/upload")).toHaveLength(0);
		});

		it("rejects a file over the 20MB cap without calling the API", async () => {
			const { args } = setup();
			const { result } = renderHook(() => useImageBedActions(args as never));
			const big = new File([new Uint8Array(1)], "big.png", { type: "image/png" });
			Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
			await act(async () => { await result.current.handleUpload(fileList([big])); });
			expect(mocks.csrfFetch.mock.calls.filter((c) => c[0] === "/api/images/upload")).toHaveLength(0);
		});

		it("continues the queue after one upload fails", async () => {
			mocks.csrfFetch.mockRejectedValueOnce(new Error("node full")).mockResolvedValue({});
			const { args } = setup();
			const { result } = renderHook(() => useImageBedActions(args as never));
			await act(async () => {
				await result.current.handleUpload(fileList([imageFile("a.png"), imageFile("b.png")]));
			});
			expect(mocks.csrfFetch.mock.calls.filter((c) => c[0] === "/api/images/upload")).toHaveLength(2);
		});
	});

	describe("destructive paths", () => {
		it("refuses a batch delete with nothing selected", async () => {
			const { args } = setup();
			const { result } = renderHook(() => useImageBedActions(args as never));
			act(() => { result.current.requestBatchDelete(); });
			expect(result.current.pendingDelete).toBeNull();
		});

		it("stages a single delete without calling the API until confirmed", () => {
			const { args } = setup();
			const { result } = renderHook(() => useImageBedActions(args as never));
			act(() => { result.current.requestDelete(args.images[0] as never); });
			expect(result.current.pendingDelete).toMatchObject({ type: "single", id: "img_1" });
			expect(mocks.csrfFetch).not.toHaveBeenCalled();
		});

		it("deletes the staged image and refreshes the current page", async () => {
			const { state, args } = setup();
			const { result } = renderHook(() => useImageBedActions(args as never));
			act(() => { result.current.requestDelete(args.images[0] as never); });
			await act(async () => { await result.current.confirmDelete(); });
			expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/images/img_1", { method: "DELETE" });
			expect(result.current.pendingDelete).toBeNull();
			expect(state.fetched).toContain(1);
		});

		it("keeps the dialog open and clears the busy flag when a delete fails", async () => {
			// `deleting` gates the confirm button's label and blocks backdrop
			// dismissal; leaking it true would wedge the dialog with no way out.
			mocks.csrfFetch.mockRejectedValue(new Error("permission denied"));
			const { args } = setup();
			const { result } = renderHook(() => useImageBedActions(args as never));
			act(() => { result.current.requestDelete(args.images[0] as never); });
			await act(async () => { await result.current.confirmDelete(); });
			expect(result.current.deleting).toBe(false);
			expect(result.current.pendingDelete).not.toBeNull();
		});

		it("sends the selected ids for a batch delete", async () => {
			const { args } = setup();
			const { result } = renderHook(() => useImageBedActions(args as never));
			act(() => { result.current.toggleSelect("img_1"); });
			act(() => { result.current.toggleSelect("img_2"); });
			act(() => { result.current.requestBatchDelete(); });
			await act(async () => { await result.current.confirmDelete(); });
			const call = mocks.csrfFetch.mock.calls.find((c) => c[0] === "/api/images/batch");
			expect(JSON.parse(call![1].body as string)).toEqual({ action: "delete", ids: ["img_1", "img_2"] });
			expect(result.current.pendingDelete).toBeNull();
		});

		it("clears the selection and leaves batch mode after a batch action", async () => {
			const { args } = setup();
			const { result } = renderHook(() => useImageBedActions(args as never));
			act(() => { result.current.toggleSelect("img_1"); });
			await act(async () => { await result.current.runBatchAction("delete"); });
			expect(result.current.selectedIds.size).toBe(0);
			expect(result.current.batchMode).toBe(false);
		});

		it("includes the album when moving a batch", async () => {
			const { args } = setup();
			const { result } = renderHook(() => useImageBedActions(args as never));
			act(() => { result.current.toggleSelect("img_1"); });
			act(() => { result.current.setBatchAlbum("archive"); });
			await act(async () => { await result.current.runBatchAction("moveAlbum"); });
			const call = mocks.csrfFetch.mock.calls.find((c) => c[0] === "/api/images/batch");
			expect(JSON.parse(call![1].body as string)).toMatchObject({ action: "moveAlbum", album: "archive" });
		});
	});

	describe("concurrency guards", () => {
		/**
		 * Both guards are refs (`deletingRef` is the `deleting` state check plus the
		 * early return; `batchBusyRef` is an explicit ref), so the second call must
		 * be issued before the first settles. A deferred promise built up-front —
		 * rather than one whose resolver is captured inside its own executor — keeps
		 * the release deterministic.
		 */
		function deferred() {
			let resolve!: (value: unknown) => void;
			const promise = new Promise((r) => { resolve = r; });
			return { promise, resolve };
		}

		it("ignores a second confirm while the first delete is in flight", async () => {
			// Double-clicking Confirm must not issue two DELETEs.
			const gate = deferred();
			mocks.csrfFetch.mockImplementation(() => gate.promise);
			const { args } = setup();
			const { result } = renderHook(() => useImageBedActions(args as never));
			act(() => { result.current.requestDelete(args.images[0] as never); });
			await act(async () => {
				const first = result.current.confirmDelete();
				const second = result.current.confirmDelete();
				gate.resolve({});
				await Promise.all([first, second]);
			});
			expect(mocks.csrfFetch.mock.calls.filter((c) => c[0] === "/api/images/img_1")).toHaveLength(1);
		});

		it("does not run a second batch action concurrently", async () => {
			const gate = deferred();
			mocks.csrfFetch.mockImplementation(() => gate.promise);
			const { args } = setup();
			const { result } = renderHook(() => useImageBedActions(args as never));
			act(() => { result.current.toggleSelect("img_1"); });
			await act(async () => {
				const first = result.current.runBatchAction("delete");
				const second = result.current.runBatchAction("delete");
				gate.resolve({});
				await Promise.all([first, second]);
			});
			expect(mocks.csrfFetch.mock.calls.filter((c) => c[0] === "/api/images/batch")).toHaveLength(1);
		});
	});
});
