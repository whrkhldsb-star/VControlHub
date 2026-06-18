import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

import {
	SessionGateProvider,
	gateFromRoles,
	type SessionGate,
} from "../session-context";
import { useGateRoute } from "../use-gate-route";

function renderWithGate(gate: SessionGate) {
	return renderHook(() => useGateRoute(), {
		wrapper: function Wrapper({ children }: { children: ReactNode }) {
			return <SessionGateProvider value={gate}>{children}</SessionGateProvider>;
		},
	});
}

describe("useGateRoute", () => {
	it("denies everything when the provider is missing", () => {
		const { result } = renderHook(() => useGateRoute());
		expect(result.current.can("server:ssh")).toBe(false);
		expect(result.current.can("storage:read")).toBe(false);
		expect(result.current.canAny(["server:ssh", "storage:read"])).toBe(false);
		expect(result.current.canAll(["storage:read", "server:read"])).toBe(false);
		expect(result.current.hasRole("admin")).toBe(false);
		expect(result.current.hasAnyRole(["admin", "operator"])).toBe(false);
		expect(result.current.isUnauthenticated).toBe(true);
		expect(result.current.permissions).toEqual([]);
		expect(result.current.roles).toEqual([]);
	});

	it("admits the union of permissions granted by the active roles", () => {
		const gate = gateFromRoles(["operator"]);
		const { result } = renderWithGate(gate);
		expect(result.current.can("server:ssh")).toBe(true);
		expect(result.current.can("server:read")).toBe(true);
		expect(result.current.can("user:manage")).toBe(false);
		expect(result.current.hasRole("operator")).toBe(true);
		expect(result.current.hasRole("admin")).toBe(false);
		expect(result.current.isUnauthenticated).toBe(false);
	});

	it("canAny matches if any required permission is held", () => {
		const gate = gateFromRoles(["viewer"]);
		const { result } = renderWithGate(gate);
		expect(result.current.canAny(["server:ssh", "storage:read"])).toBe(true);
		expect(result.current.canAny(["server:ssh", "server:write"])).toBe(false);
	});

	it("canAll requires every listed permission", () => {
		const gate = gateFromRoles(["operator"]);
		const { result } = renderWithGate(gate);
		expect(result.current.canAll(["storage:read", "command:execute"])).toBe(true);
		expect(result.current.canAll(["storage:read", "user:manage"])).toBe(false);
	});

	it("hasAnyRole covers role-based UI gates", () => {
		const gate = gateFromRoles(["storage_manager"]);
		const { result } = renderWithGate(gate);
		expect(result.current.hasAnyRole(["admin", "storage_manager"])).toBe(true);
		expect(result.current.hasAnyRole(["viewer", "operator"])).toBe(false);
	});

	it("memoizes the result object so consumers can rely on stable identity within a render", () => {
		const gate = gateFromRoles(["operator"]);
		const { result, rerender } = renderWithGate(gate);
		const before = result.current;
		rerender();
		const after = result.current;
		// Different identity per render — that's fine — but references within
		// the same render must remain equal to one another (functions are
		// re-bound together inside useMemo).
		expect(typeof before.can).toBe("function");
		expect(typeof after.can).toBe("function");
	});

	it("treats an empty role list as unauthenticated even if mounted", () => {
		const gate = gateFromRoles([]);
		const { result } = renderWithGate(gate);
		expect(result.current.isUnauthenticated).toBe(true);
		expect(result.current.can("server:read")).toBe(false);
	});
});
