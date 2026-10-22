// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { updateServerAgentHeartbeat } from "../agent-service";
import { getServerTargetAvailability } from "../availability";

/**
 * A Windows node is created "needs attention" until its Agent connects. A
 * working Agent's heartbeats never moved it on, so it stayed unselectable as
 * a command target ("setup incomplete") for good.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("Windows Agent onboarding (PostgreSQL)", () => {
	const id = `winagent-${randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.server.create({
			data: { id, name: id, host: "203.0.113.20", port: 3389, username: "Administrator", tags: [], operatingSystem: "WINDOWS", managementMode: "AGENT", connectionType: "PASSWORD", onboardingStatus: "NEEDS_ATTENTION" },
		});
	});
	afterAll(async () => {
		await prisma.server.deleteMany({ where: { id } });
		await prisma.$disconnect();
	});

	it("becomes a command target once its Agent reports in", async () => {
		await updateServerAgentHeartbeat({ serverId: id, version: "1.4.1", capabilities: ["command"] });
		const server = await prisma.server.findUniqueOrThrow({ where: { id }, select: { onboardingStatus: true, managementMode: true, agentLastSeenAt: true } });
		expect(server.onboardingStatus).toBe("READY");
		expect(getServerTargetAvailability({ ...server, hasSshCredential: false })).toEqual({ available: true, reason: null });
	});
});
