import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { customerSession, routeSession } from "@/test/route-session-mock";

vi.mock("@/lib/auth/api-session", async () => {
	const { NextResponse } = await import("next/server");
	const unauthenticated = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });
	return {
		getApiSession: vi.fn(async () => routeSession.current),
		requireApiSession: vi.fn(async () => routeSession.current ?? unauthenticated()),
		isSessionPayload: (value: unknown) => !(value instanceof Response),
	};
});
vi.mock("@/lib/http/rate-limit-presets", () => ({
	GENERAL_WRITE_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	GENERAL_READ_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	UPLOAD_CHUNK_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const dir = mkdtempSync(path.join(tmpdir(), "vps-backup-"));
writeFileSync(path.join(dir, "full.tar.gz"), "gzip-bytes");
const mocks = vi.hoisted(() => ({ assertServerTeamAccess: vi.fn(), recordFindFirst: vi.fn(), resolveVpsBackupFilePath: vi.fn() }));
vi.mock("@/lib/server/team-access", () => ({ assertServerTeamAccess: mocks.assertServerTeamAccess }));
vi.mock("@/lib/db", () => ({ prisma: { vpsBackupRecord: { findFirst: mocks.recordFindFirst } } }));
vi.mock("@/lib/backup/vps-backup-service", () => ({ resolveVpsBackupFilePath: mocks.resolveVpsBackupFilePath }));
vi.mock("@/lib/storage/offsite/schema", () => ({ loadOffsiteConfig: vi.fn(async () => ({ enabled: false })), validateOffsiteConfigForUse: vi.fn(() => []) }));

const route = await import("../records/[recordId]/download/route");
const get = () => route.GET(new Request("http://local/x"), { params: Promise.resolve({ id: "srv_1", recordId: "rec_1" }) });

describe("GET /api/servers/[id]/vps-backup/records/[recordId]/download", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["server:ssh"]);
		mocks.assertServerTeamAccess.mockResolvedValue({ ok: true });
		mocks.recordFindFirst.mockResolvedValue({ id: "rec_1", localPath: "full.tar.gz", backupType: "FULL", status: "COMPLETED", offsiteKey: null });
		mocks.resolveVpsBackupFilePath.mockImplementation((p: string) => path.join(dir, p));
	});

	it("needs server:ssh and file-read access to that server", async () => {
		routeSession.current = customerSession(["server:read"]);
		expect((await get()).status).toBe(403);
		routeSession.current = customerSession(["server:ssh"]);
		mocks.assertServerTeamAccess.mockResolvedValueOnce({ ok: false, response: new Response("no", { status: 404 }) });
		expect((await get()).status).toBe(404);
		expect(mocks.assertServerTeamAccess).toHaveBeenLastCalledWith(expect.anything(), "srv_1", "fileRead");
	});

	it("streams a completed record of this server as a gzip attachment", async () => {
		const res = await get();
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/gzip");
		expect(res.headers.get("content-disposition")).toContain("FULL-rec_1.tar.gz");
		expect(res.headers.get("content-length")).toBe("10");
		expect(await res.text()).toBe("gzip-bytes");
		expect(mocks.recordFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "rec_1", serverId: "srv_1" } }));
	});

	it("refuses records that are missing, unfinished or whose file is gone with no offsite copy", async () => {
		mocks.recordFindFirst.mockResolvedValueOnce(null);
		expect((await get()).status).toBe(404);
		mocks.recordFindFirst.mockResolvedValueOnce({ id: "rec_1", localPath: "full.tar.gz", backupType: "FULL", status: "RUNNING", offsiteKey: null });
		expect((await get()).status).toBe(400);
		mocks.recordFindFirst.mockResolvedValueOnce({ id: "rec_1", localPath: "missing.tar.gz", backupType: "FULL", status: "COMPLETED", offsiteKey: null });
		expect((await get()).status).toBe(404);
	});
});
