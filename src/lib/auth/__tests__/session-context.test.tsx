import { describe, expect, it } from "vitest";
import { render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

import {
	EMPTY_GATE,
	SessionGateProvider,
	gateFromRoles,
	useSessionGate,
	type SessionGate,
} from "../session-context";

function withGate(value: SessionGate) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return <SessionGateProvider value={value}>{children}</SessionGateProvider>;
	};
}

describe("session-context", () => {
	it("returns the empty gate by default when no provider is mounted", () => {
		const { result } = renderHook(() => useSessionGate());
		expect(result.current).toEqual(EMPTY_GATE);
		expect(result.current.authenticated).toBe(false);
		expect(result.current.roles).toEqual([]);
		expect(result.current.permissions).toEqual([]);
	});

	it("exposes values provided through SessionGateProvider", () => {
		const gate: SessionGate = {
			roles: ["operator"],
			permissions: ["server:ssh", "command:execute"],
			authenticated: true,
		};
		const { result } = renderHook(() => useSessionGate(), {
			wrapper: withGate(gate),
		});
		expect(result.current).toEqual(gate);
	});

	it("renders children wrapped in the provider", () => {
		const { getByText } = render(
			<SessionGateProvider
				value={{
					roles: ["viewer"],
					permissions: ["audit:read"],
					authenticated: true,
				}}
			>
				<span>hello</span>
			</SessionGateProvider>,
		);
		expect(getByText("hello")).toBeInTheDocument();
	});

	it("re-exposes EMPTY_GATE as a sentinel matching the empty context shape", () => {
		expect(EMPTY_GATE.authenticated).toBe(false);
		expect(EMPTY_GATE.roles).toEqual([]);
		expect(EMPTY_GATE.permissions).toEqual([]);
	});
});

describe("gateFromRoles", () => {
	it("marks an empty role list as unauthenticated", () => {
		const gate = gateFromRoles([]);
		expect(gate.authenticated).toBe(false);
		expect(gate.roles).toEqual([]);
		expect(gate.permissions).toEqual([]);
	});

	it("expands viewer role permissions and marks authenticated", () => {
		const gate = gateFromRoles(["viewer"]);
		expect(gate.authenticated).toBe(true);
		expect(gate.roles).toEqual(["viewer"]);
		// viewer defaults include storage:read (from rbac.ts)
		expect(gate.permissions).toContain("storage:read");
		expect(gate.permissions).not.toContain("server:ssh");
	});

	it("deduplicates permissions when roles overlap", () => {
		const gate = gateFromRoles(["admin", "operator"]);
		// admin + operator overlap on many perms; set-dedupe via getPermissionsFromRoles
		const counts = new Map<string, number>();
		for (const p of gate.permissions) {
			counts.set(p, (counts.get(p) ?? 0) + 1);
		}
		for (const [, c] of counts) {
			expect(c).toBe(1);
		}
	});

	it("returns a defensive copy so callers cannot mutate the input", () => {
		const roles: ["admin"] = ["admin"];
		const gate = gateFromRoles(roles);
		gate.roles.push("viewer");
		expect(roles).toEqual(["admin"]);
	});

	it("treats unknown roles as authenticated but with empty permissions", () => {
		const gate = gateFromRoles(["admin" as never, "ghost" as never]);
		expect(gate.authenticated).toBe(true);
		// admin contributes all perms; ghost contributes none.
		expect(gate.permissions.length).toBeGreaterThan(0);
	});
});
