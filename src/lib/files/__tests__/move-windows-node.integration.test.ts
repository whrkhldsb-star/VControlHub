// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { seen } = vi.hoisted(() => ({ seen: [] as Array<{ host: string; port: number }> }));
// No network: record where each SSH call would connect.
vi.mock("@/lib/ssh/client", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/ssh/client")>()),
	resolveRemoteRealPath: vi.fn(async (input: { host: string; port: number; remotePath: string }) => {
		seen.push({ host: input.host, port: input.port });
		return input.remotePath;
	}),
	statRemoteEntry: vi.fn(async (input: { host: string; port: number }) => {
		seen.push({ host: input.host, port: input.port });
		return null;
	}),
	renameRemoteFile: vi.fn(async (input: { host: string; port: number }) => {
		seen.push({ host: input.host, port: input.port });
	}),
}));

import { prisma } from "@/lib/db";
import { executeMoveFile } from "../move-operation";

/**
 * A storage node bound to a Windows server is reached over OpenSSH on port 22,
 * not on the server's RDP port. The move loaded the server without its OS,
 * so it dialled the RDP port.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("moving a file on a Windows-bound SFTP node (PostgreSQL)", () => {
	const prefix = `mvw-${randomUUID().slice(0, 8)}`;
	const session = { userId: prefix, username: prefix, roles: ["admin" as const], mustChangePassword: false, currentTeamId: null };
	let entryId = "";

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "unused" } });
		await prisma.server.create({
			data: { id: prefix, name: prefix, host: "198.51.100.40", port: 48163, username: "Administrator", operatingSystem: "WINDOWS", connectionType: "PASSWORD", password: "enc:v1:unused", hostKeySha256: "SHA256:pin", tags: [] },
		});
		const node = await prisma.storageNode.create({ data: { name: prefix, driver: "SFTP", basePath: "/data", serverId: prefix } });
		const entry = await prisma.fileEntry.create({ data: { name: "a.txt", entryType: "FILE", relativePath: "a.txt", storageNodeId: node.id, size: BigInt(1) } });
		entryId = entry.id;
	});
	afterAll(async () => {
		await prisma.storageNode.deleteMany({ where: { serverId: prefix } });
		await prisma.server.deleteMany({ where: { id: prefix } });
		await prisma.user.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("connects on port 22, not the RDP port", async () => {
		const form = new FormData();
		form.set("fileEntryId", entryId);
		form.set("targetDir", "docs");
		await executeMoveFile(session as never, form, "en");
		expect(seen.length).toBeGreaterThan(0);
		expect(seen.every((call) => call.host === "198.51.100.40" && call.port === 22)).toBe(true);
	});
});
