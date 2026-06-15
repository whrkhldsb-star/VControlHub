import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiPermissionMock = vi.fn();
const listQaReportsMock = vi.fn();
const getQaReportDetailMock = vi.fn();

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: requireApiPermissionMock,
}));

// Use the real apiCatch + real NotFoundError by re-importing them.
// We mock only the QA service + auth gate to control handler behavior.
vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: requireApiPermissionMock,
}));

vi.mock("@/lib/qa-reports/service", () => ({
	listQaReports: listQaReportsMock,
	getQaReportDetail: getQaReportDetailMock,
}));

async function loadListRoute() {
	const mod = await import("@/app/api/admin/qa-reports/route");
	return mod as unknown as {
		GET: (request: Request) => Promise<Response>;
	};
}

async function loadDetailRoute() {
	const mod = await import("@/app/api/admin/qa-reports/[id]/route");
	return mod as unknown as {
		GET: (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
	};
}

describe("GET /api/admin/qa-reports", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		requireApiPermissionMock.mockResolvedValue({ session: { userId: "u1", username: "admin", roles: ["admin"] } });
		listQaReportsMock.mockResolvedValue({
			reports: [
				{
					id: "slice:media-x",
					kind: "slice",
					title: "已闭环 slice · media-x",
					finishedAt: "2026-06-07T16:22:34.000Z",
					status: "completed",
					summary: "demo",
					evidenceCount: 2,
				},
			],
			totals: { total: 1, slices: 1, blockers: 0, qaRuns: 0 },
			lastUpdatedAt: "2026-06-07T16:22:34.000Z",
			trends: {
				cards: [],
				dailyBuckets: [],
				moduleCoverage: [],
				recentRuns: [],
				lastFailure: null,
				sourceUpdatedAt: null,
			},
		});
	});

	it("returns 200 + report aggregate when admin caller is allowed", async () => {
		const { GET } = await loadListRoute();
		const response = await GET(new Request("http://local/api/admin/qa-reports"));
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.totals.total).toBe(1);
		expect(body.reports[0].id).toBe("slice:media-x");
	});

	it("returns 401 when the caller has no task:read permission", async () => {
		requireApiPermissionMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401 }),
		);
		const { GET } = await loadListRoute();
		const response = await GET(new Request("http://local/api/admin/qa-reports"));
		expect(response.status).toBe(401);
	});
});

describe("GET /api/admin/qa-reports/[id]", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		requireApiPermissionMock.mockResolvedValue({ session: { userId: "u1", username: "admin", roles: ["admin"] } });
	});

	it("returns the detail when present", async () => {
		getQaReportDetailMock.mockResolvedValueOnce({
			id: "slice:media-x",
			kind: "slice",
			title: "已闭环 slice · media-x",
			finishedAt: "2026-06-07T16:22:34.000Z",
			status: "completed",
			summary: "demo",
			evidenceCount: 1,
			sourceId: "media-x",
			evidence: [{ command: "cmd", result: "ok" }],
		});
		const { GET } = await loadDetailRoute();
		const response = await GET(new Request("http://local/api/admin/qa-reports/slice:media-x"), {
			params: Promise.resolve({ id: "slice:media-x" }),
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.evidence).toHaveLength(1);
	});

	it("returns 404 when the report id is unknown", async () => {
		getQaReportDetailMock.mockResolvedValueOnce(null);
		const { GET } = await loadDetailRoute();
		const response = await GET(new Request("http://local/api/admin/qa-reports/missing"), {
			params: Promise.resolve({ id: "missing" }),
		});
		expect(response.status).toBe(404);
	});
});
