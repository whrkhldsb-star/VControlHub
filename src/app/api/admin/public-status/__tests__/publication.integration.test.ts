// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { saveAuditedPublication } from "../mutations";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("publication audit on PostgreSQL", () => {
	const id = "publication-" + randomUUID();
	let ready = false;

	beforeAll(async () => {
		const url = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) {
			throw new Error("Disposable database required");
		}
		await prisma.$transaction([
			prisma.user.create({ data: { id, username: id, passwordHash: "fixture" } }),
			prisma.server.create({ data: { id, name: id, host: "example.invalid", username: "fixture" } }),
		]);
		ready = true;
	});

	afterAll(async () => {
		if (ready) {
			await prisma.auditLog.deleteMany({ where: { actorId: id } });
			await prisma.server.delete({ where: { id } });
			await prisma.user.delete({ where: { id } });
		}
		await prisma.$disconnect();
	});

	it("records exactly one initial publication and one subsequent save", async () => {
		const node = { displayName: "Node", published: true, tags: [], region: null, groupName: null, note: null, sortOrder: 0, maintenance: false };
		const [first, second] = await Promise.all([saveAuditedPublication(id, node, id), saveAuditedPublication(id, node, id)]);
		expect(first).toEqual(second);
		const events = await prisma.auditLog.findMany({ where: { actorId: id }, orderBy: { action: "asc" }, select: { action: true, severity: true } });
		expect(events).toEqual([
			{ action: "public_status.node.publish", severity: "WARNING" },
			{ action: "public_status.node.update", severity: "INFO" },
		]);
	});
});
