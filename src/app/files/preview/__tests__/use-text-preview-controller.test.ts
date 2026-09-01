import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `useTextPreviewController` — the online file editor's controller.
 *
 * Three properties carry real risk.
 *
 * 1. **The SFTP save is optimistically locked.** The remote read hands back
 *    `lastModifiedMs`, the save sends it as `expectedLastModifiedMs`, and the
 *    server refuses a write whose token no longer matches. Before that existed,
 *    two people editing the same remote file produced a silent lost update. The
 *    token must also be *refreshed from the write response*, or the next save
 *    409s against the user's own work.
 *
 * 2. **A stale save cannot write into a different file.** `performSave` captures
 *    `loadVersionRef` and the entry id, and drops its state updates if either
 *    moved — the user can navigate to another file while a save is in flight.
 *
 * 3. **Save-and-reload only reloads after the save succeeded.** Restarting a
 *    systemd unit or a compose service against a file that failed to save would
 *    apply the *old* config while telling the user their edit went live.
 */
const mocks = vi.hoisted(() => ({ csrfFetch: vi.fn(), fetch: vi.fn() }));

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.csrfFetch }));

import { useTextPreviewController } from "../use-text-preview-controller";

const t = ((key: string, vars?: Record<string, unknown>) =>
	vars ? `${key}:${JSON.stringify(vars)}` : key) as never;

function setup(overrides: Record<string, unknown> = {}) {
	return renderHook(() =>
		useTextPreviewController({
			href: "/api/files/raw/1",
			name: "nginx.conf",
			fileEntryId: "fe_1",
			editable: true,
			driver: "SFTP",
			nodeId: "node_1",
			relativePath: "etc/nginx.conf",
			t,
			...overrides,
		} as never),
	);
}

/** Wait for the mount-time load to finish. */
async function loaded(result: { current: { state: { loading: boolean } } }) {
	await waitFor(() => expect(result.current.state.loading).toBe(false));
}

describe("useTextPreviewController", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.csrfFetch.mockReset();
		mocks.csrfFetch.mockResolvedValue({ content: "server {}", encoding: "text", lastModifiedMs: 5_000 });
		// The non-editable branch reads through global `fetch`. Stub it, but restore
		// in afterEach — test files share a worker, so a leaked stub breaks whichever
		// unrelated file happens to run next in the same process.
		vi.stubGlobal("fetch", mocks.fetch);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe("SFTP optimistic lock", () => {
		it("sends the mtime the read returned as the save token", async () => {
			const { result } = setup();
			await loaded(result);
			mocks.csrfFetch.mockResolvedValue({ success: true, byteSize: 9, lastModifiedMs: 7_000 });
			act(() => { result.current.setDraft("server { listen 80; }"); });
			await act(async () => { await result.current.handleSave(); });

			const write = mocks.csrfFetch.mock.calls.find(
				(c) => c[0] === "/api/storage/sftp-ops" && JSON.parse(c[1].body as string).action === "write",
			);
			expect(JSON.parse(write![1].body as string)).toMatchObject({
				action: "write",
				expectedLastModifiedMs: 5_000,
			});
		});

		it("adopts the post-write mtime so the next save is not a self-conflict", async () => {
			// Reusing the load-time token (or a local clock) would make the second
			// save 409 against the user's own first write.
			const { result } = setup();
			await loaded(result);
			mocks.csrfFetch.mockResolvedValue({ success: true, byteSize: 9, lastModifiedMs: 7_000 });
			act(() => { result.current.setDraft("v1"); });
			await act(async () => { await result.current.handleSave(); });

			act(() => { result.current.setEditMode(true); });
			act(() => { result.current.setDraft("v2"); });
			await act(async () => { await result.current.handleSave(); });

			const writes = mocks.csrfFetch.mock.calls.filter(
				(c) => c[0] === "/api/storage/sftp-ops" && JSON.parse(c[1].body as string).action === "write",
			);
			expect(JSON.parse(writes.at(-1)![1].body as string).expectedLastModifiedMs).toBe(7_000);
		});

		it("omits the token when the node could not report an mtime", async () => {
			// Better to save without protection than to refuse the save entirely.
			mocks.csrfFetch.mockResolvedValue({ content: "x", encoding: "text", lastModifiedMs: null });
			const { result } = setup();
			await loaded(result);
			mocks.csrfFetch.mockResolvedValue({ success: true, byteSize: 1, lastModifiedMs: null });
			act(() => { result.current.setDraft("y"); });
			await act(async () => { await result.current.handleSave(); });
			const write = mocks.csrfFetch.mock.calls.find(
				(c) => c[0] === "/api/storage/sftp-ops" && JSON.parse(c[1].body as string).action === "write",
			);
			expect(JSON.parse(write![1].body as string)).not.toHaveProperty("expectedLastModifiedMs");
		});

		it("surfaces a 409 as a save error and stays in edit mode", async () => {
			const { result } = setup();
			await loaded(result);
			mocks.csrfFetch.mockRejectedValue(new Error("file changed on disk"));
			act(() => { result.current.setEditMode(true); });
			act(() => { result.current.setDraft("mine"); });
			await act(async () => { await result.current.handleSave(); });
			expect(result.current.saveStatus).toBe("error");
			expect(result.current.saveMessage).toContain("file changed on disk");
			// The draft must survive so the user can diff and re-apply.
			expect(result.current.draft).toBe("mine");
			expect(result.current.editMode).toBe(true);
		});

		it("refuses a binary remote file instead of corrupting it on save", async () => {
			mocks.csrfFetch.mockResolvedValue({ content: "AAAA", encoding: "base64" });
			const { result } = setup();
			// PreviewState is a union; narrow via `loading` before reading `error`.
			await waitFor(() => expect(result.current.state.loading).toBe(false));
			expect("error" in result.current.state && result.current.state.error).toBeTruthy();
		});
	});

	describe("LOCAL save", () => {
		it("sends both optimistic-lock tokens the editable route expects", async () => {
			mocks.csrfFetch.mockResolvedValue({
				draft: { content: "hello", updatedAt: "2026-08-31T00:00:00.000Z", lastModifiedMs: 1_234 },
			});
			const { result } = setup({ driver: "LOCAL", nodeId: undefined, relativePath: undefined });
			await loaded(result);
			mocks.csrfFetch.mockResolvedValue({
				file: { byteSize: 5, updatedAt: "2026-08-31T01:00:00.000Z", lastModifiedMs: 9_999 },
			});
			act(() => { result.current.setDraft("hello world"); });
			await act(async () => { await result.current.handleSave(); });
			const put = mocks.csrfFetch.mock.calls.find((c) => c[1]?.method === "PUT");
			expect(JSON.parse(put![1].body as string)).toMatchObject({
				expectedUpdatedAt: "2026-08-31T00:00:00.000Z",
				expectedLastModifiedMs: 1_234,
			});
		});
	});

	describe("save and reload", () => {
		it("does not reload when the save failed", async () => {
			// Restarting the unit here would apply the OLD config while telling the
			// user their edit is live.
			const { result } = setup({ serverId: "srv_1", reloadUnit: "nginx", reloadKind: "systemd" });
			await loaded(result);
			mocks.csrfFetch.mockRejectedValue(new Error("permission denied"));
			act(() => { result.current.setDraft("broken"); });
			await act(async () => { await result.current.handleSaveAndReload(); });
			const reloads = mocks.csrfFetch.mock.calls.filter((c) => String(c[0]).includes("/reload"));
			expect(reloads).toHaveLength(0);
			expect(result.current.saveStatus).toBe("error");
		});

		it("reloads the systemd unit after a successful save", async () => {
			const { result } = setup({ serverId: "srv_1", reloadUnit: "nginx", reloadKind: "systemd" });
			await loaded(result);
			mocks.csrfFetch.mockImplementation(async (url: string) =>
				String(url).includes("/reload")
					? { success: true, exitCode: 0 }
					: { success: true, byteSize: 4, lastModifiedMs: 8_000 },
			);
			act(() => { result.current.setDraft("ok"); });
			await act(async () => { await result.current.handleSaveAndReload(); });
			const reload = mocks.csrfFetch.mock.calls.find((c) => String(c[0]).includes("/reload"));
			expect(JSON.parse(reload![1].body as string)).toEqual({ kind: "systemd", unit: "nginx" });
			expect(result.current.saveStatus).toBe("reloaded");
		});

		it("reports a non-zero reload exit without claiming success", async () => {
			const { result } = setup({ serverId: "srv_1", reloadUnit: "nginx", reloadKind: "systemd" });
			await loaded(result);
			mocks.csrfFetch.mockImplementation(async (url: string) =>
				String(url).includes("/reload")
					? { success: false, exitCode: 1, stderr: "nginx: configuration file test failed\nmore" }
					: { success: true, byteSize: 4, lastModifiedMs: 8_000 },
			);
			act(() => { result.current.setDraft("bad config"); });
			await act(async () => { await result.current.handleSaveAndReload(); });
			expect(result.current.saveStatus).toBe("error");
			// Only the first stderr line, bounded — a failed nginx -t can be long.
			expect(result.current.reloadMessage).toContain("exit=1");
			expect(result.current.reloadMessage).not.toContain("more");
		});

		it("derives the compose project directory from the file's own path", async () => {
			const { result } = setup({
				serverId: "srv_1",
				reloadUnit: "web",
				reloadKind: "compose",
				relativePath: "stacks/blog/docker-compose.yml",
			});
			await loaded(result);
			mocks.csrfFetch.mockImplementation(async (url: string) =>
				String(url).includes("/reload")
					? { success: true, exitCode: 0 }
					: { success: true, byteSize: 4, lastModifiedMs: 8_000 },
			);
			act(() => { result.current.setDraft("ok"); });
			await act(async () => { await result.current.handleSaveAndReload(); });
			const reload = mocks.csrfFetch.mock.calls.find((c) => String(c[0]).includes("/reload"));
			expect(JSON.parse(reload![1].body as string)).toEqual({
				kind: "compose",
				projectDir: "/stacks/blog",
				service: "web",
			});
		});

		it("saves without reloading when no unit is configured", async () => {
			const { result } = setup();
			await loaded(result);
			mocks.csrfFetch.mockResolvedValue({ success: true, byteSize: 4, lastModifiedMs: 8_000 });
			act(() => { result.current.setDraft("ok"); });
			await act(async () => { await result.current.handleSaveAndReload(); });
			expect(mocks.csrfFetch.mock.calls.filter((c) => String(c[0]).includes("/reload"))).toHaveLength(0);
			expect(result.current.saveStatus).toBe("saved");
		});
	});

	describe("cancelEdit", () => {
		it("restores the saved content and clears the save banner", async () => {
			const { result } = setup();
			await loaded(result);
			act(() => { result.current.setEditMode(true); });
			act(() => { result.current.setDraft("scratch"); });
			act(() => { result.current.cancelEdit(); });
			expect(result.current.draft).toBe("server {}");
			expect(result.current.editMode).toBe(false);
			expect(result.current.saveStatus).toBe("idle");
		});
	});
});
