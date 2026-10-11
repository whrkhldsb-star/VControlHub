import { act, renderHook } from "@testing-library/react";
import type { MouseEvent, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionGateProvider, type SessionGate } from "@/lib/auth/session-context";

const csrfFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch }));

const { useNotificationLink } = await import("../use-notification-link");

function render(gate: Partial<SessionGate>) {
	const value: SessionGate = { roles: [], permissions: [], authenticated: true, currentTeamId: null, ...gate };
	const wrapper = ({ children }: { children: ReactNode }) => <SessionGateProvider value={value}>{children}</SessionGateProvider>;
	return renderHook(() => useNotificationLink(), { wrapper }).result.current;
}

function click(handler: (event: MouseEvent<HTMLAnchorElement>) => void) {
	const event = { preventDefault: vi.fn() } as unknown as MouseEvent<HTMLAnchorElement>;
	handler(event);
	return event;
}

describe("useNotificationLink", () => {
	const assign = vi.fn();
	beforeEach(() => {
		csrfFetch.mockResolvedValue({ success: true });
		vi.stubGlobal("location", { ...window.location, assign });
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("switches an administrator to the notification's customer before opening it", async () => {
		const link = render({ roles: ["admin"], currentTeamId: "team_a" });
		expect(link.showCustomer).toBe(true);
		const event = click(link.onOpen({ teamId: "team_b", actionUrl: "/servers" }));
		expect(event.preventDefault).toHaveBeenCalled();
		await act(async () => {});
		expect(csrfFetch).toHaveBeenCalledWith("/api/teams/switch", expect.objectContaining({ body: JSON.stringify({ teamId: "team_b" }) }));
		expect(assign).toHaveBeenCalledWith("/servers");
	});

	it("opens links directly when the target is already visible", () => {
		for (const gate of [
			{ roles: ["admin"] as SessionGate["roles"], currentTeamId: null },
			{ roles: ["admin"] as SessionGate["roles"], currentTeamId: "team_b" },
			{ roles: [] as SessionGate["roles"], currentTeamId: "team_a" },
		]) {
			const event = click(render(gate).onOpen({ teamId: "team_b", actionUrl: "/servers" }));
			expect(event.preventDefault).not.toHaveBeenCalled();
		}
		expect(csrfFetch).not.toHaveBeenCalled();
	});
});
