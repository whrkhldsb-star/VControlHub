// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { closeAdvisoryLockPoolForTests } from "@/lib/concurrency/advisory-lock";
import { exportFileSchema, type ExportFile } from "../config-schema";
import { buildExportFile } from "../export-service";
import { executeImport } from "../import-executors";
import { previewImport } from "../import-preview";

/**
 * A customer's package leaves out what belongs to other customers. A server
 * that was transferred to this customer still logs in with the SSH key of the
 * customer it came from, and a storage node may sit on a server of another
 * customer: the package names both, and carries neither.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("config import: references a customer package does not carry (PostgreSQL)", () => {
	const p = `ref-${randomUUID().slice(0, 8)}`;
	const admin = { userId: `${p}-admin`, username: `${p}-admin`, roles: ["admin" as const], mustChangePassword: false, currentTeamId: `${p}-team-b` };
	const options = { dryRun: false, overwriteExisting: false, importUsers: true, importSettings: false };
	let file: ExportFile;

	const cleanup = async () => {
		await prisma.storageNode.deleteMany({ where: { id: { startsWith: p } } });
		await prisma.server.deleteMany({ where: { id: { startsWith: p } } });
		await prisma.sshKey.deleteMany({ where: { id: { startsWith: p } } });
		await prisma.team.deleteMany({ where: { id: { startsWith: p } } });
	};

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		// ── The source instance ──
		await prisma.team.createMany({ data: [{ id: `${p}-team-a`, slug: `${p}-a`, name: "A" }, { id: `${p}-team-b`, slug: `${p}-b`, name: "B" }] });
		await prisma.sshKey.create({ data: { id: `${p}-key-a`, name: "a-deploy", fingerprint: `SHA256:${p}-a`, publicKey: "ssh-ed25519 AAAA", privateKey: "enc:key", teamId: `${p}-team-a` } });
		await prisma.sshKey.create({ data: { id: `${p}-key-b`, name: "b-deploy", fingerprint: `SHA256:${p}-b`, publicKey: "ssh-ed25519 BBBB", privateKey: "enc:key", teamId: `${p}-team-b` } });
		await prisma.server.create({ data: { id: `${p}-host-a`, name: `${p}-host-a`, host: `${p}-a.test`, username: "root", teamId: `${p}-team-a`, connectionType: "PASSWORD" } });
		// Transferred from A: the customer changed, the key did not.
		await prisma.server.create({ data: { id: `${p}-moved`, name: `${p}-moved`, host: `${p}-moved.test`, username: "root", teamId: `${p}-team-b`, connectionType: "SSH_KEY", sshKeyId: `${p}-key-a` } });
		await prisma.server.create({ data: { id: `${p}-own`, name: `${p}-own`, host: `${p}-own.test`, username: "root", teamId: `${p}-team-b`, connectionType: "SSH_KEY", sshKeyId: `${p}-key-b` } });
		await prisma.storageNode.create({ data: { id: `${p}-node-foreign`, name: `${p}-node-foreign`, driver: "SFTP", basePath: "/srv", teamId: `${p}-team-b`, serverId: `${p}-host-a` } });
		await prisma.storageNode.create({ data: { id: `${p}-node-own`, name: `${p}-node-own`, driver: "SFTP", basePath: "/srv", teamId: `${p}-team-b`, serverId: `${p}-own` } });

		const exported = await buildExportFile({ session: admin as never, mode: "standard", scope: "team", sourceDomain: "source.test" });
		const parsed = exportFileSchema.parse(JSON.parse(JSON.stringify(exported)));
		const ours = <T>(rows: T[]) => rows.filter((row) => JSON.stringify(row).includes(p));
		file = { ...parsed, tables: Object.fromEntries(Object.entries(parsed.tables).map(([name, rows]) => [name, ours(rows as unknown[])])) as ExportFile["tables"] };

		// ── The target instance: none of it exists ──
		await cleanup();
	}, 60_000);
	afterAll(async () => {
		await cleanup();
		await closeAdvisoryLockPoolForTests();
		await prisma.$disconnect();
	});

	it("carries the customer's own key and servers, not the other customer's", () => {
		expect(file.tables.sshKeys.map((key) => key.id)).toEqual([`${p}-key-b`]);
		expect(file.tables.servers.map((server) => server.id).sort()).toEqual([`${p}-moved`, `${p}-own`]);
		expect(file.tables.servers.find((server) => server.id === `${p}-moved`)).toMatchObject({ sshKeyId: `${p}-key-a` });
		expect(file.tables.storageNodes.find((node) => node.id === `${p}-node-foreign`)).toMatchObject({ serverId: `${p}-host-a` });
	});

	it("says in the preview that a server and a storage node lose what they point at", async () => {
		const preview = await previewImport(file, { ...options, dryRun: true });
		expect(preview.warnings).toContain("systemConfig.import.preview.warning.serverKeysMissing");
		expect(preview.warnings).toContain("systemConfig.import.preview.warning.storageServersMissing");
	});

	it("imports the package: the server arrives without a key, the node without a server", async () => {
		// One missing key used to fail the server insert on its foreign key and
		// roll the whole package back.
		const result = await executeImport(file, options);
		expect(result.errors).toEqual([]);
		expect(result.rolledBack).toBeUndefined();

		expect(await prisma.server.findUniqueOrThrow({ where: { id: `${p}-moved` } })).toMatchObject({ teamId: `${p}-team-b`, connectionType: "SSH_KEY", sshKeyId: null });
		expect(await prisma.server.findUniqueOrThrow({ where: { id: `${p}-own` } })).toMatchObject({ sshKeyId: `${p}-key-b` });
		expect(await prisma.storageNode.findUniqueOrThrow({ where: { id: `${p}-node-foreign` } })).toMatchObject({ teamId: `${p}-team-b`, serverId: null });
		expect(await prisma.storageNode.findUniqueOrThrow({ where: { id: `${p}-node-own` } })).toMatchObject({ serverId: `${p}-own` });
	});

	it("keeps a reference that resolves on this instance, and the one already set when overwriting", async () => {
		// The other customer's key and server exist here now.
		await prisma.team.create({ data: { id: `${p}-team-a`, slug: `${p}-a`, name: "A" } });
		await prisma.sshKey.create({ data: { id: `${p}-key-a`, name: "a-deploy", fingerprint: `SHA256:${p}-a`, publicKey: "ssh-ed25519 AAAA", teamId: `${p}-team-a` } });
		await prisma.server.create({ data: { id: `${p}-host-a`, name: `${p}-host-a`, host: `${p}-a.test`, username: "root", teamId: `${p}-team-a`, connectionType: "PASSWORD" } });
		const result = await executeImport(file, { ...options, overwriteExisting: true });
		expect(result.errors).toEqual([]);
		expect(await prisma.server.findUniqueOrThrow({ where: { id: `${p}-moved` } })).toMatchObject({ sshKeyId: `${p}-key-a` });
		expect(await prisma.storageNode.findUniqueOrThrow({ where: { id: `${p}-node-foreign` } })).toMatchObject({ serverId: `${p}-host-a` });
		const preview = await previewImport(file, { ...options, dryRun: true });
		expect(preview.warnings).not.toContain("systemConfig.import.preview.warning.serverKeysMissing");
		expect(preview.warnings).not.toContain("systemConfig.import.preview.warning.storageServersMissing");
	});
});
