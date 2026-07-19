import { describe, expect, it, vi, beforeEach } from "vitest";

const { requireApiPermissionMock, getObservabilitySnapshotMock } = vi.hoisted(() => ({
	requireApiPermissionMock: vi.fn(async () => ({
		session: {
			userId: "u1",
			username: "alice",
			roles: ["admin"],
			currentTeamId: null,
		},
	})),
	getObservabilitySnapshotMock: vi.fn(() => ({
		collectedAt: "2026-01-01T00:00:00.000Z",
		webVitals: { byName: {}, recent: [] },
		delivery: {},
		websocket: {
			notification: { active: 1, opened: 2, closed: 1, errors: 0, rejected: 0, reconnectHints: 0 },
			ssh: { active: 0, opened: 0, closed: 0, errors: 0, rejected: 0, reconnectHints: 0 },
		},
	})),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: requireApiPermissionMock,
}));

vi.mock("@/lib/monitoring/runtime-metrics", () => ({
	getObservabilitySnapshot: getObservabilitySnapshotMock,
	setWsActive: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
	createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET } from "../route";

describe("GET /api/monitoring/observability", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Prevent real network scrape of SSH-WS metrics during unit tests.
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({
					websocket: { active: 3, opened: 5, closed: 2, errors: 0, rejected: 1, reconnectHints: 0 },
					activeClients: 3,
				}),
			})),
		);
	});

	it("requires audit:read and returns metrics snapshot", async () => {
		const res = await GET(new Request("http://local/api/monitoring/observability"));
		const body = await res.json();
		expect(res.status).toBe(200);
		expect(requireApiPermissionMock).toHaveBeenCalledWith("audit:read");
		expect(body.metrics.websocket.ssh.active).toBe(3);
		expect(body.metrics.websocket.notification.active).toBe(1);
	});
});
