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

export const routeSession: { current: RouteTestSession | null } = { current: null };

export function platformSession(overrides: Partial<RouteTestSession> = {}): RouteTestSession {
	return { userId: "u_admin", username: "admin", roles: ["admin"], permissions: [], currentTeamId: null, mustChangePassword: false, ...overrides };
}

export function customerSession(permissions: string[], overrides: Partial<RouteTestSession> = {}): RouteTestSession {
	return { userId: "u_cust", username: "cust", roles: [], permissions, currentTeamId: "team_1", mustChangePassword: false, ...overrides };
}
