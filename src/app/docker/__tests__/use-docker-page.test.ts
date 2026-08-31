import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `useDockerPage`.
 *
 * Two properties carry real risk here.
 *
 * 1. **Destructive actions go through an in-app confirm.** `container remove`
 *    and `compose down` must stage a pending item rather than firing straight at
 *    the API — `down` in particular tears down a project's containers. Neither
 *    may touch the network until the user confirms.
 *
 * 2. **The server pin.** Every request carries `serverId` from the selection at
 *    the time the action started, and the post-action refresh is skipped when the
 *    user switched servers mid-flight. Without that guard, a stale closure aborts
 *    the new selection's in-flight list request and repaints server A's
 *    containers under server B's name — which, for a destructive follow-up, means
 *    acting on a list that does not belong to the selected host.
 */
const mocks = vi.hoisted(() => ({ csrfFetch: vi.fn() }));

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.csrfFetch }));
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import { useDockerPage } from "../use-docker-page";

const container = { Id: "c1", Names: ["/web"], State: "running", Image: "nginx" } as never;

function listResponse(names: string[] = ["/web"]) {
	return {
		containers: names.map((n, i) => ({ Id: `c${i + 1}`, Names: [n], State: "running", Image: "nginx" })),
		projects: [],
	};
}

function setup(servers: Array<{ id: string; name: string; host: string }> = [], canManageHubHost = true) {
	return renderHook(() => useDockerPage(servers as never, canManageHubHost));
}

describe("useDockerPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.csrfFetch.mockReset();
		mocks.csrfFetch.mockResolvedValue(listResponse());
	});

	afterEach(() => {
		cleanup();
	});

	describe("destructive confirmation", () => {
		it("stages a container removal without calling the API", async () => {
			const { result } = setup();
			await act(async () => {});
			mocks.csrfFetch.mockClear();
			act(() => { result.current.requestRemoval(container); });
			expect(result.current.pendingRemoval).toMatchObject({ Id: "c1" });
			expect(mocks.csrfFetch.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(0);
		});

		it("removes the container only after confirmation", async () => {
			const { result } = setup();
			await act(async () => {});
			act(() => { result.current.requestRemoval(container); });
			mocks.csrfFetch.mockClear();
			await act(async () => { await result.current.confirmRemoval(); });
			const post = mocks.csrfFetch.mock.calls.find((c) => c[0] === "/api/docker/containers" && c[1]?.method === "POST");
			expect(JSON.parse(post![1].body as string)).toMatchObject({ id: "c1", action: "remove" });
			expect(result.current.pendingRemoval).toBeNull();
		});

		it("stages a compose down instead of tearing the project down immediately", async () => {
			// `down` stops and removes every container in the project.
			const { result } = setup();
			await act(async () => {});
			mocks.csrfFetch.mockClear();
			await act(async () => { await result.current.handleProjectAction("stack", "down"); });
			expect(result.current.pendingProjectDown).toBe("stack");
			expect(mocks.csrfFetch.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(0);
		});

		it("runs non-destructive project actions without a confirm step", async () => {
			const { result } = setup();
			await act(async () => {});
			mocks.csrfFetch.mockClear();
			await act(async () => { await result.current.handleProjectAction("stack", "restart"); });
			expect(result.current.pendingProjectDown).toBeNull();
			const post = mocks.csrfFetch.mock.calls.find((c) => c[0] === "/api/docker/compose");
			expect(JSON.parse(post![1].body as string)).toMatchObject({ project: "stack", action: "restart" });
		});

		it("issues no mutating request when confirming with nothing staged", async () => {
			const { result } = setup();
			await act(async () => {});
			mocks.csrfFetch.mockClear();
			await act(async () => {
				await result.current.confirmRemoval();
				await result.current.confirmProjectDown();
			});
			// A background list refresh may still run; what must not happen is a POST.
			const mutating = mocks.csrfFetch.mock.calls.filter((c) => c[1]?.method === "POST");
			expect(mutating).toHaveLength(0);
		});
	});

	describe("server pin", () => {
		it("omits serverId for the hub host and includes it for a remote node", async () => {
			const servers = [{ id: "srv_1", name: "web", host: "10.0.0.1" }];
			const { result } = setup(servers, true);
			await act(async () => {});
			mocks.csrfFetch.mockClear();
			await act(async () => { await result.current.handleAction(container, "restart"); });
			// Hub host is the default for a platform manager: no serverId sent.
			let body = JSON.parse(
				mocks.csrfFetch.mock.calls.find((c) => c[1]?.method === "POST")![1].body as string,
			);
			expect(body.serverId).toBeUndefined();

			act(() => { result.current.setSelectedServerId("srv_1"); });
			await act(async () => {});
			mocks.csrfFetch.mockClear();
			await act(async () => { await result.current.handleAction(container, "restart"); });
			body = JSON.parse(
				mocks.csrfFetch.mock.calls.find((c) => c[1]?.method === "POST")![1].body as string,
			);
			expect(body.serverId).toBe("srv_1");
		});

		it("defaults a non-platform-manager to their first server rather than the hub host", async () => {
			// The hub host answers 403 for them (see assertHubHostDockerAccess), so
			// defaulting there would render an error on page load.
			const servers = [{ id: "srv_1", name: "web", host: "10.0.0.1" }];
			const { result } = setup(servers, false);
			await act(async () => {});
			expect(result.current.selectedServerId).toBe("srv_1");
		});

		it("surfaces an ok:false payload as an error instead of reporting success", async () => {
			mocks.csrfFetch.mockImplementation(async (_url: string, init?: { method?: string }) =>
				init?.method === "POST" ? { ok: false, message: "container is already stopped" } : listResponse(),
			);
			const { result } = setup();
			await act(async () => {});
			await act(async () => { await result.current.handleAction(container, "stop"); });
			expect(result.current.error).toBe("container is already stopped");
		});

		it("reports a thrown request failure", async () => {
			mocks.csrfFetch.mockImplementation(async (_url: string, init?: { method?: string }) => {
				if (init?.method === "POST") throw new Error("daemon unreachable");
				return listResponse();
			});
			const { result } = setup();
			await act(async () => {});
			await act(async () => { await result.current.handleAction(container, "stop"); });
			expect(result.current.error).toContain("daemon unreachable");
			expect(result.current.actionLoading).toBeNull();
		});

		it("clears the action spinner even when the request fails", async () => {
			mocks.csrfFetch.mockRejectedValue(new Error("boom"));
			const { result } = setup();
			await act(async () => {});
			await act(async () => { await result.current.handleAction(container, "stop"); });
			expect(result.current.actionLoading).toBeNull();
		});
	});
});
