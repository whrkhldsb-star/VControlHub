// @vitest-environment node
// Uses only a disposable audit database; no SSH or Agent work is started.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { heartbeatRunningCommandRequest } from "../service-execution";
import { recoverStaleRunningCommandRequests } from "../service-recovery";

/**
 * The recovery sweep reads a request whose heartbeat looks stale, and before
 * it writes, the executor comes back and renews the heartbeat (a slow
 * database, a paused process). The sweep must leave that request running.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("command recovery racing a renewed heartbeat (PostgreSQL)", () => {
	const prefix = `vch-recover-${randomUUID()}`;
	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("This regression requires an isolated loopback audit/test database");
		}
		await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "not-a-login-hash" } });
		await prisma.server.create({ data: { id: prefix, name: prefix, host: "192.0.2.8", username: "audit", tags: [], connectionType: "PASSWORD", password: "audit-only", hostKeySha256: "SHA256:audit-only" } });
		await prisma.commandRequest.create({ data: { id: prefix, title: "Audit", command: "printf audit", requesterId: prefix, initiatedByType: "USER", status: "RUNNING",
			workerId: "worker-a", workerHeartbeatAt: new Date(Date.now() - 24 * 3_600_000),
			targets: { create: { id: prefix, serverId: prefix, status: "RUNNING" } } } });
	});
	afterAll(async () => {
		await prisma.commandRequest.deleteMany({ where: { id: prefix } });
		await prisma.server.deleteMany({ where: { id: prefix } });
		await prisma.user.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("keeps a request whose executor renewed its heartbeat after the sweep read it", async () => {
		const findMany = prisma.commandRequest.findMany.bind(prisma.commandRequest);
		const spy = vi.spyOn(prisma.commandRequest, "findMany").mockImplementation((async (args: Parameters<typeof findMany>[0]) => {
			const candidates = await findMany(args);
			// The executor is back between the sweep's read and its write.
			await heartbeatRunningCommandRequest(prefix);
			return candidates;
		}) as never);
		const result = await recoverStaleRunningCommandRequests();
		spy.mockRestore();

		const request = await prisma.commandRequest.findUniqueOrThrow({ where: { id: prefix }, include: { targets: true } });
		expect(result.recovered).toBe(0);
		expect(request.status).toBe("RUNNING");
		expect(request.workerHeartbeatAt).not.toBeNull();
		expect(request.targets[0]).toMatchObject({ status: "RUNNING", outcomeUnknown: false });
	});
});
