// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getPublicStatus, getPublicStatusSummary } from "./service";
import { probeAllStaleStorageNodes } from "@/lib/storage/health";

const { probe } = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("@/lib/storage/service-nodes", () => ({ checkStorageNodeHealth: probe }));
vi.mock("@/lib/storage/health", async (importOriginal) => ({
	...await importOriginal<typeof import("@/lib/storage/health")>(),
	scheduleStorageNodeHealthProbe: vi.fn(),
}));

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("retired workspace storage health", () => {
	const prefix = `status-${randomUUID()}`;
	const activeTeam = `${prefix}-active`;
	const deletedTeam = `${prefix}-deleted`;
	const activeNode = `${prefix}-active-node`;
	const deletedNode = `${prefix}-deleted-node`;
	const legacyNode = `${prefix}-legacy-node`;
	const fixtureIds = [activeNode, deletedNode, legacyNode];
	const checkedAt = new Date("2020-01-01T00:00:00Z");

	beforeAll(async () => {
		const db = new URL(process.env.DATABASE_URL!);
		if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) {
			throw new Error("Storage health regression requires an isolated database");
		}
		await prisma.team.createMany({ data: [
			// LIKE treats underscores as wildcards; this is a live, valid slug.
			{ id: activeTeam, name: prefix, slug: `abdeletedcd-${prefix}` },
			{ id: deletedTeam, name: prefix, slug: `__deleted__${prefix}` },
		] });
		await prisma.storageNode.createMany({ data: [
			{ id: activeNode, name: prefix, driver: "LOCAL", basePath: "/unused-status-test", teamId: activeTeam, healthStatus: "HEALTHY", lastHealthCheckAt: checkedAt },
			{ id: deletedNode, name: prefix, driver: "LOCAL", basePath: "/unused-status-test", teamId: deletedTeam, healthStatus: "UNHEALTHY", lastHealthCheckAt: checkedAt },
			{ id: legacyNode, name: prefix, driver: "LOCAL", basePath: "/unused-status-test", healthStatus: "HEALTHY", lastHealthCheckAt: checkedAt },
		] });
	});
	beforeEach(async () => {
		probe.mockReset().mockResolvedValue({ healthStatus: "HEALTHY" });
		await prisma.storageNode.updateMany({ where: { id: { in: [activeNode, legacyNode] } }, data: { healthStatus: "HEALTHY" } });
	});
	afterAll(async () => {
		await prisma.storageNode.deleteMany({ where: { id: { in: fixtureIds } } });
		await prisma.team.deleteMany({ where: { id: { in: [activeTeam, deletedTeam] } } });
		await prisma.$disconnect();
	});

	it("ignores retired failures in both public and detailed status", async () => {
		expect((await getPublicStatusSummary()).summary.overall).toBe("healthy");
		const storage = (await getPublicStatus()).checks.find((check) => check.id === "storage");
		expect(storage?.status).toBe("healthy");
		expect(storage?.message).toContain("0 unhealthy");
	});

	it.each(["active", "legacy"])("still warns about unhealthy %s storage", async (kind) => {
		await prisma.storageNode.update({ where: { id: kind === "active" ? activeNode : legacyNode }, data: { healthStatus: "UNHEALTHY" } });
		expect((await getPublicStatusSummary()).summary.overall).toBe("warning");
		const storage = (await getPublicStatus()).checks.find((check) => check.id === "storage");
		expect(storage?.status).toBe("warning");
		expect(storage?.message).toContain("1 unhealthy");
	});

	it("probes stale active and legacy storage without probing retired nodes", async () => {
		await probeAllStaleStorageNodes();
		expect(probe).toHaveBeenCalledWith(activeNode);
		expect(probe).toHaveBeenCalledWith(legacyNode);
		expect(probe).not.toHaveBeenCalledWith(deletedNode);
	});
});
