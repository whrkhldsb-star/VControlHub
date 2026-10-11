import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/errors";
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
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({
	assertServerTeamAccess: vi.fn(), snapshotFindMany: vi.fn(), serverFindFirst: vi.fn(), tcpProbe: vi.fn(),
	assertSftpPathAccess: vi.fn(), listDirectory: vi.fn(), makeDirectory: vi.fn(), deleteFile: vi.fn(), renameEntry: vi.fn(), loadEnabledServerForSftp: vi.fn(),
	auditUserAction: vi.fn(),
}));
vi.mock("@/lib/server/team-access", () => ({ assertServerTeamAccess: mocks.assertServerTeamAccess }));
vi.mock("@/lib/db", () => ({ prisma: { serverUptimeSnapshot: { findMany: mocks.snapshotFindMany }, server: { findFirst: mocks.serverFindFirst } } }));
vi.mock("@/lib/server/connectivity", async (original) => ({ ...((await original()) as Record<string, unknown>), tcpProbe: mocks.tcpProbe }));
vi.mock("@/lib/ssh/sftp-service", () => ({ listDirectory: mocks.listDirectory, makeDirectory: mocks.makeDirectory, deleteFile: mocks.deleteFile, renameEntry: mocks.renameEntry }));
vi.mock("@/lib/ssh/server-target", () => ({ loadEnabledServerForSftp: mocks.loadEnabledServerForSftp }));
vi.mock("@/lib/ssh/sftp-access-control", () => ({ assertSftpPathAccess: mocks.assertSftpPathAccess }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const uptime = await import("../uptime/route");
const rdpProbe = await import("../rdp-probe/route");
const list = await import("../sftp/list/route");
const mkdir = await import("../sftp/mkdir/route");
const del = await import("../sftp/delete/route");
const rename = await import("../sftp/rename/route");
const req = (method: string, url: string, body?: unknown) =>
	new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = Promise.resolve({ id: "srv_1" });

describe("server uptime, RDP probe and SFTP routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["server:read", "server:ssh"]);
		mocks.assertServerTeamAccess.mockResolvedValue({ ok: true });
		mocks.snapshotFindMany.mockResolvedValue([{ date: new Date("2026-07-18T16:00:00Z"), uptimePercent: 99.5, onlineMinutes: 1430, offlineMinutes: 10, checkCount: 288 }]);
		mocks.serverFindFirst.mockResolvedValue({ id: "srv_1", host: "203.0.113.5", port: 3389, operatingSystem: "WINDOWS" });
		mocks.tcpProbe.mockResolvedValue({ ok: true, latencyMs: 12 });
		mocks.assertSftpPathAccess.mockResolvedValue(undefined);
		mocks.listDirectory.mockResolvedValue([{ name: "a.txt" }]);
		mocks.loadEnabledServerForSftp.mockResolvedValue({ rootPath: "/root" });
	});

	it("uptime days are labelled on the application clock and gated by server access", async () => {
		const res = await uptime.GET(req("GET", "http://local/api/servers/srv_1/uptime") as never, { params });
		expect(await res.json()).toEqual({ data: [{ date: "2026-07-19", uptimePercent: 99.5, onlineMinutes: 1430, offlineMinutes: 10, checkCount: 288 }] });
		mocks.assertServerTeamAccess.mockResolvedValue({ ok: false, response: new Response("no", { status: 404 }) });
		expect((await uptime.GET(req("GET", "http://local/api/servers/srv_1/uptime") as never, { params })).status).toBe(404);
	});

	it("the RDP probe only answers for Windows servers in scope and never leaks the reason", async () => {
		expect(await (await rdpProbe.GET(req("GET", "http://local/api/servers/srv_1/rdp-probe"), { params })).json()).toEqual({ reachable: true, latencyMs: 12 });
		expect(mocks.tcpProbe).toHaveBeenCalledWith("203.0.113.5", 3389, 5000);
		mocks.serverFindFirst.mockResolvedValue({ id: "srv_1", host: "h", port: 22, operatingSystem: "LINUX" });
		expect((await rdpProbe.GET(req("GET", "http://local/api/servers/srv_1/rdp-probe"), { params })).status).toBe(404);
	});

	it("SFTP operations check file-level access, then the path policy, then audit", async () => {
		expect(await (await list.POST(req("POST", "http://local/api/servers/srv_1/sftp/list", {}), { params })).json()).toEqual({ path: "/root", entries: [{ name: "a.txt" }] });
		expect(mocks.assertServerTeamAccess).toHaveBeenCalledWith(expect.anything(), "srv_1", "fileRead");
		expect(mocks.assertSftpPathAccess).toHaveBeenCalledWith({ session: expect.anything(), serverId: "srv_1", paths: ["/root"] });

		await mkdir.POST(req("POST", "http://local/api/servers/srv_1/sftp/mkdir", { path: "/root/new" }), { params });
		expect(mocks.assertServerTeamAccess).toHaveBeenLastCalledWith(expect.anything(), "srv_1", "fileWrite");
		expect(mocks.makeDirectory).toHaveBeenCalledWith("srv_1", "/root/new");
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "sftp.mkdir", { serverId: "srv_1", path: "/root/new" }, undefined, "team_1");

		await rename.POST(req("POST", "http://local/api/servers/srv_1/sftp/rename", { oldPath: "/root/a", newPath: "/root/b" }), { params });
		expect(mocks.assertSftpPathAccess).toHaveBeenLastCalledWith({ session: expect.anything(), serverId: "srv_1", paths: ["/root/a", "/root/b"] });
		expect(mocks.renameEntry).toHaveBeenCalledWith("srv_1", "/root/a", "/root/b");

		await del.DELETE(req("DELETE", "http://local/api/servers/srv_1/sftp/delete?path=%2Froot%2Fa"), { params });
		expect(mocks.assertServerTeamAccess).toHaveBeenLastCalledWith(expect.anything(), "srv_1", "fileDelete");
		expect(mocks.deleteFile).toHaveBeenCalledWith("srv_1", "/root/a");
	});

	it("a path outside the allowed roots is refused before any SFTP call", async () => {
		mocks.assertSftpPathAccess.mockRejectedValue(new ForbiddenError("outside root"));
		expect((await mkdir.POST(req("POST", "http://local/api/servers/srv_1/sftp/mkdir", { path: "/etc" }), { params })).status).toBe(403);
		expect(mocks.makeDirectory).not.toHaveBeenCalled();
		expect((await del.DELETE(req("DELETE", "http://local/api/servers/srv_1/sftp/delete"), { params })).status).toBe(400);
	});
});
