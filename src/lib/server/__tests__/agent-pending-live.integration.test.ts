// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { findLivePendingAgentJobId } from "../agent-service";

/**
 * Which PENDING job an Agent may still run is decided in SQL from "createdAt",
 * a column that holds UTC wall time. The answer must not depend on the time
 * zone the PostgreSQL session happens to run in.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("live PENDING Agent job (PostgreSQL)", () => {
	const prefix = `agentlive-${randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.server.create({ data: { id: prefix, name: prefix, host: "agentlive.test", username: "root", tags: [], managementMode: "AGENT" } });
		await prisma.serverAgentJob.createMany({
			data: [
				// Three hours old with a one-minute budget: long expired, and the oldest.
				{ id: `${prefix}-expired`, serverId: prefix, command: "true", timeoutMs: 60_000, createdAt: new Date(Date.now() - 3 * 3_600_000) },
				// One hour old with a ninety-minute budget: still to run.
				{ id: `${prefix}-live`, serverId: prefix, command: "true", timeoutMs: 90 * 60_000, createdAt: new Date(Date.now() - 3_600_000) },
			],
		});
	});
	afterAll(async () => {
		await prisma.serverAgentJob.deleteMany({ where: { serverId: prefix } });
		await prisma.server.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	// East of UTC the live job used to count as expired (nothing found); west
	// of UTC the expired one counted as live (and, being older, came first).
	it.each(["UTC", "Asia/Shanghai", "America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago"])(
		"finds the job that can still run when the session runs in %s",
		async (zone) => {
			const found = await prisma.$transaction(async (tx) => {
				await tx.$queryRaw`SELECT set_config('TimeZone', ${zone}, true)`;
				return findLivePendingAgentJobId(tx, prefix);
			});
			expect(found).toBe(`${prefix}-live`);
		},
	);
});
