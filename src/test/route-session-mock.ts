/**
 * Session plumbing for route tests that keep the real `withApiRoute` guard.
 * The test file mocks `@/lib/auth/api-session` to answer with
 * `routeSession.current` (vi.mock has to sit at the test file's top level),
 * so permission checks, body validation and error mapping all run for real.
 */

export type RouteTestSession = {
	userId: string;
	username: string;
	roles: string[];
	permissions: string[];
	currentTeamId: string | null;
	mustChangePassword: boolean;
};

import { ALL_PERMISSIONS } from "@/lib/auth/rbac";

export const routeSession: { current: RouteTestSession | null } = { current: null };

export function platformSession(overrides: Partial<RouteTestSession> = {}): RouteTestSession {
	// A real admin session carries every permission resolved from its role, so
	// routes guarded by ordinary (non platform-only) permissions pass too.
	return { userId: "u_admin", username: "admin", roles: ["admin"], permissions: [...ALL_PERMISSIONS], currentTeamId: null, mustChangePassword: false, ...overrides };
}

export function customerSession(permissions: string[], overrides: Partial<RouteTestSession> = {}): RouteTestSession {
	return { userId: "u_cust", username: "cust", roles: [], permissions, currentTeamId: "team_1", mustChangePassword: false, ...overrides };
}
