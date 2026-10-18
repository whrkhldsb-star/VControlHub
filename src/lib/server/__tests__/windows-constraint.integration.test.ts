// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

/**
 * The migrated schema must accept what the Windows services write: Agent
 * mode with its token, and the optional SFTP binding's password. It still
 * refuses an SSH key, which Windows nodes never use.
 *
 * CHECK constraints come only from migrations: CI's main suite runs on a
 * `db push` schema without them, so CI also runs this file against the
 * database its migration-chain step built (see ci.yml).
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("Windows server constraint in PostgreSQL", () => {
	const prefix = `win-check-${randomUUID()}`;
	let migrated = false;
	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci|_migrate/.test(database.pathname)) {
			throw new Error("Windows constraint integration requires an isolated loopback audit/test database");
		}
		const constraint = await prisma.$queryRaw<unknown[]>`SELECT 1 FROM pg_constraint WHERE conname = 'servers_windows_isolation_check'`;
		migrated = constraint.length > 0;
		await prisma.sshKey.create({ data: { id: prefix, name: prefix, fingerprint: prefix, publicKey: "unused" } });
	});
	afterAll(async () => {
		await prisma.server.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.sshKey.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	const windows = (suffix: string, data: Record<string, unknown>) => prisma.server.create({
		data: { id: `${prefix}-${suffix}`, name: `${prefix}-${suffix}`, host: `${suffix}.${prefix}.test`, port: 3389, username: "Administrator", operatingSystem: "WINDOWS", connectionType: "PASSWORD", ...data },
	});

	it("stores a Windows node under Agent mode with its token", async () => {
		await expect(windows("agent", { managementMode: "AGENT", agentTokenHash: "hash" })).resolves.toMatchObject({ managementMode: "AGENT" });
	});

	it("stores the optional SFTP binding's password", async () => {
		await expect(windows("sftp", { password: "enc:v1:sftp" })).resolves.toMatchObject({ password: "enc:v1:sftp" });
	});

	it("still refuses an SSH key on a Windows node", async (context) => {
		if (!migrated) context.skip();
		await expect(windows("key", { sshKeyId: prefix })).rejects.toThrow(/servers_windows_isolation_check|constraint/i);
	});
});
