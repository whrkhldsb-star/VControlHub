import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Contract tests for the four `/api/announcements` methods.
 *
 * Announcements are a **platform-wide broadcast** by design — the model carries
 * no `teamId` — so there is no tenant filter to pin here. The two properties
 * that matter instead:
 *
 * 1. GET is only `{ requireAuth: true }`, and the *handler* decides what the
 *    caller may see: an `announcement:manage` holder gets `listAnnouncements()`
 *    (every row, including unpublished drafts and expired notices), everyone
 *    else gets `listActiveAnnouncements()` (published + inside its window).
 *    Getting that branch backwards would leak unpublished drafts to every
 *    authenticated user, which is why it gets its own cases.
 *
 * 2. The wire shape and the storage shape use different names: the request says
 *    `content`/`type`, the row says `body`/`level`. PATCH additionally treats
 *    `expiresAt` as tri-state — absent means "leave it alone", explicit `null`
 *    means "clear it", a string means "set it" — and collapsing `null` into
 *    `undefined` would make an expiry impossible to remove.
 */
const mocks = vi.hoisted(() => ({
	listAnnouncements: vi.fn(),
	listActiveAnnouncements: vi.fn(),
	createAnnouncement: vi.fn(),
	updateAnnouncement: vi.fn(),
	deleteAnnouncement: vi.fn(),
	auditUserAction: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/announcement/service", () => ({
	listAnnouncements: mocks.listAnnouncements,
	listActiveAnnouncements: mocks.listActiveAnnouncements,
	createAnnouncement: mocks.createAnnouncement,
	updateAnnouncement: mocks.updateAnnouncement,
	deleteAnnouncement: mocks.deleteAnnouncement,
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (request: Request, options: any, handler: any) => {
		mocks.guardCalls.push(options);
		let body: unknown = undefined;
		if (options.bodySchema) {
			const raw = await request.clone().json().catch(() => undefined);
			const parsed = options.bodySchema.safeParse(raw);
			if (!parsed.success) return Response.json({ error: "VALIDATION_FAILED" }, { status: 400 });
			body = parsed.data;
		}
		let query: unknown = undefined;
		if (options.querySchema) {
			const url = new URL(request.url);
			const parsed = options.querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
			if (!parsed.success) return Response.json({ error: "VALIDATION_FAILED" }, { status: 400 });
			query = parsed.data;
		}
		try {
			return await handler({ session, body, query });
		} catch (error) {
			// Mirror the real guard: an AppError keeps its own status.
			const status = (error as { status?: number }).status ?? options.errorStatus ?? 500;
			return Response.json({ error: (error as Error).message }, { status });
		}
	}),
}));

const session = {
	userId: "u_1",
	username: "op",
	roles: ["operator"],
	permissions: ["announcement:manage"] as string[],
	mustChangePassword: false,
	currentTeamId: "team_1",
};

const route = await import("../route");

const announcementView = {
	id: "ann_1",
	title: "maintenance window",
	body: "we are patching tonight",
	level: "warning",
	pinned: true,
	published: true,
	startsAt: new Date("2026-08-31T00:00:00.000Z"),
	expiresAt: null as Date | null,
};

function req(method: string, body?: unknown, url = "https://a.test/api/announcements") {
	return new Request(url, {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

describe("/api/announcements routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.guardCalls.length = 0;
		session.permissions = ["announcement:manage"];
		session.currentTeamId = "team_1";
		mocks.listAnnouncements.mockReset();
		mocks.listActiveAnnouncements.mockReset();
		mocks.createAnnouncement.mockReset();
		mocks.updateAnnouncement.mockReset();
		mocks.deleteAnnouncement.mockReset();
		mocks.listAnnouncements.mockResolvedValue([announcementView]);
		mocks.listActiveAnnouncements.mockResolvedValue([announcementView]);
		mocks.createAnnouncement.mockResolvedValue(announcementView);
		mocks.updateAnnouncement.mockResolvedValue(announcementView);
		mocks.deleteAnnouncement.mockResolvedValue(announcementView);
	});

	describe("guard options", () => {
		it("lets any authenticated user read but gates the three writes on announcement:manage", async () => {
			await route.GET(req("GET"));
			await route.POST(req("POST", { title: "t", content: "c" }));
			await route.PATCH(req("PATCH", { id: "ann_1", title: "t" }));
			await route.DELETE(req("DELETE", undefined, "https://a.test/api/announcements?id=ann_1"));
			expect(mocks.guardCalls[0]).toEqual({ requireAuth: true });
			expect(mocks.guardCalls.slice(1).map((o) => o.permission)).toEqual([
				"announcement:manage",
				"announcement:manage",
				"announcement:manage",
			]);
		});

		it("rate-limits the three write methods but not the read", async () => {
			await route.GET(req("GET"));
			await route.POST(req("POST", { title: "t", content: "c" }));
			await route.PATCH(req("PATCH", { id: "ann_1", title: "t" }));
			await route.DELETE(req("DELETE", undefined, "https://a.test/api/announcements?id=ann_1"));
			expect(mocks.guardCalls.map((o) => Boolean(o.rateLimit))).toEqual([false, true, true, true]);
		});
	});

	describe("GET", () => {
		it("returns every row, drafts included, to an announcement:manage holder", async () => {
			const res = await route.GET(req("GET"));
			expect(res.status).toBe(200);
			expect(mocks.listAnnouncements).toHaveBeenCalledTimes(1);
			expect(mocks.listActiveAnnouncements).not.toHaveBeenCalled();
		});

		it("returns only the active set to a caller without announcement:manage", async () => {
			// Without this branch every authenticated user would see unpublished
			// drafts and expired notices.
			session.permissions = ["server:read"];
			const res = await route.GET(req("GET"));
			expect(res.status).toBe(200);
			expect(mocks.listActiveAnnouncements).toHaveBeenCalledTimes(1);
			expect(mocks.listAnnouncements).not.toHaveBeenCalled();
		});

		it("wraps the rows under an `announcements` key", async () => {
			mocks.listActiveAnnouncements.mockResolvedValue([{ id: "ann_1", title: "hi" }]);
			session.permissions = [];
			const res = await route.GET(req("GET"));
			await expect(res.json()).resolves.toEqual({ announcements: [{ id: "ann_1", title: "hi" }] });
		});
	});

	describe("POST", () => {
		it("renames content→body and type→level and stamps the author", async () => {
			const res = await route.POST(req("POST", {
				title: "maintenance window",
				content: "we are patching tonight",
				type: "warning",
				pinned: true,
				published: true,
			}));
			expect(res.status).toBe(201);
			expect(mocks.createAnnouncement).toHaveBeenCalledWith({
				title: "maintenance window",
				body: "we are patching tonight",
				level: "warning",
				pinned: true,
				published: true,
				createdBy: "u_1",
				startsAt: undefined,
				expiresAt: null,
			});
		});

		it("passes startsAt/expiresAt through as Date objects", async () => {
			await route.POST(req("POST", {
				title: "t",
				content: "c",
				startsAt: "2026-09-01T00:00:00.000Z",
				expiresAt: "2026-09-02T00:00:00.000Z",
			}));
			const arg = mocks.createAnnouncement.mock.calls[0]![0] as { startsAt?: Date; expiresAt?: Date | null };
			expect(arg.startsAt).toEqual(new Date("2026-09-01T00:00:00.000Z"));
			expect(arg.expiresAt).toEqual(new Date("2026-09-02T00:00:00.000Z"));
		});

		it("audits the creation against the caller's team", async () => {
			await route.POST(req("POST", { title: "t", content: "c" }));
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"announcement.create",
				{ announcementId: "ann_1" },
				undefined,
				"team_1",
			);
		});

		it("rejects an expiresAt that is not after startsAt", async () => {
			const res = await route.POST(req("POST", {
				title: "t",
				content: "c",
				startsAt: "2026-09-02T00:00:00.000Z",
				expiresAt: "2026-09-01T00:00:00.000Z",
			}));
			expect(res.status).toBe(400);
			expect(mocks.createAnnouncement).not.toHaveBeenCalled();
		});

		it("rejects an unknown level", async () => {
			const res = await route.POST(req("POST", { title: "t", content: "c", type: "catastrophic" }));
			expect(res.status).toBe(400);
		});

		it("rejects a non-ISO startsAt", async () => {
			const res = await route.POST(req("POST", { title: "t", content: "c", startsAt: "tomorrow" }));
			expect(res.status).toBe(400);
		});

		it("rejects a blank title and a blank content", async () => {
			expect((await route.POST(req("POST", { title: "   ", content: "c" }))).status).toBe(400);
			expect((await route.POST(req("POST", { title: "t", content: "   " }))).status).toBe(400);
			expect(mocks.createAnnouncement).not.toHaveBeenCalled();
		});

		it("rejects content over 5000 characters", async () => {
			const res = await route.POST(req("POST", { title: "t", content: "x".repeat(5001) }));
			expect(res.status).toBe(400);
		});
	});

	describe("PATCH", () => {
		it("renames the fields and never forwards id inside the update payload", async () => {
			const res = await route.PATCH(req("PATCH", {
				id: "ann_1",
				content: "revised",
				type: "urgent",
				pinned: false,
			}));
			expect(res.status).toBe(200);
			expect(mocks.updateAnnouncement).toHaveBeenCalledWith("ann_1", {
				body: "revised",
				level: "urgent",
				pinned: false,
				expiresAt: undefined,
			});
		});

		it("treats an absent expiresAt as 'leave it alone'", async () => {
			await route.PATCH(req("PATCH", { id: "ann_1", published: true }));
			const arg = mocks.updateAnnouncement.mock.calls[0]![1] as { expiresAt?: Date | null };
			expect(arg.expiresAt).toBeUndefined();
		});

		it("passes an explicit null through so an expiry can be cleared", async () => {
			// Collapsing null into undefined here would make "never expires" an
			// unreachable state once an expiry had been set.
			await route.PATCH(req("PATCH", { id: "ann_1", expiresAt: null }));
			const arg = mocks.updateAnnouncement.mock.calls[0]![1] as { expiresAt?: Date | null };
			expect(arg.expiresAt).toBeNull();
		});

		it("converts a string expiresAt to a Date", async () => {
			await route.PATCH(req("PATCH", { id: "ann_1", expiresAt: "2026-12-01T00:00:00.000Z" }));
			const arg = mocks.updateAnnouncement.mock.calls[0]![1] as { expiresAt?: Date | null };
			expect(arg.expiresAt).toEqual(new Date("2026-12-01T00:00:00.000Z"));
		});

		it("rejects a PATCH that names no field", async () => {
			const res = await route.PATCH(req("PATCH", { id: "ann_1" }));
			expect(res.status).toBe(400);
			expect(mocks.updateAnnouncement).not.toHaveBeenCalled();
		});

		it("rejects a non-ISO expiresAt", async () => {
			const res = await route.PATCH(req("PATCH", { id: "ann_1", expiresAt: "next week" }));
			expect(res.status).toBe(400);
		});

		it("audits the resulting visibility flags, not the requested ones", async () => {
			// The audit trail should record what the row actually became — the
			// service can refuse or normalise, so echoing the request would log a
			// change that never happened.
			mocks.updateAnnouncement.mockResolvedValue({
				...announcementView,
				pinned: false,
				published: false,
				level: "info",
			});
			await route.PATCH(req("PATCH", { id: "ann_1", pinned: true, published: true, type: "urgent" }));
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"announcement.update",
				{ announcementId: "ann_1", pinned: false, published: false, level: "info" },
				undefined,
				"team_1",
			);
		});

		it("maps a missing announcement to 404 with no audit entry", async () => {
			mocks.updateAnnouncement.mockRejectedValue(new NotFoundError("announcement not found"));
			const res = await route.PATCH(req("PATCH", { id: "ann_9", title: "x" }));
			expect(res.status).toBe(404);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});

		it("maps a service-side window violation to 400", async () => {
			// The schema cannot check `expiresAt > startsAt` on update because it
			// never sees the stored startsAt — the service does, and its
			// ValidationError must not surface as a 500.
			mocks.updateAnnouncement.mockRejectedValue(new ValidationError("expiresAt must be after startsAt"));
			const res = await route.PATCH(req("PATCH", { id: "ann_1", expiresAt: "2020-01-01T00:00:00.000Z" }));
			expect(res.status).toBe(400);
		});
	});

	describe("DELETE", () => {
		it("deletes by query id and audits", async () => {
			const res = await route.DELETE(req("DELETE", undefined, "https://a.test/api/announcements?id=ann_1"));
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({ success: true });
			expect(mocks.deleteAnnouncement).toHaveBeenCalledWith("ann_1");
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"announcement.delete",
				{ announcementId: "ann_1" },
				undefined,
				"team_1",
			);
		});

		it("rejects a request with no id", async () => {
			const res = await route.DELETE(req("DELETE"));
			expect(res.status).toBe(400);
			expect(mocks.deleteAnnouncement).not.toHaveBeenCalled();
		});

		it("maps a missing announcement to 404 with no audit entry", async () => {
			mocks.deleteAnnouncement.mockRejectedValue(new NotFoundError("announcement not found"));
			const res = await route.DELETE(req("DELETE", undefined, "https://a.test/api/announcements?id=ann_9"));
			expect(res.status).toBe(404);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});
	});
});
