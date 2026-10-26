// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { syncBuiltinIdentityTemplates } from "@/lib/auth/identity-template-service";
import { closeAdvisoryLockPoolForTests } from "@/lib/concurrency/advisory-lock";
import { exportFileSchema, type ExportFile } from "../config-schema";
import { buildExportFile } from "../export-service";
import { executeImport } from "../import-executors";

/**
 * A full export taken on one instance and imported into another that was
 * initialised separately, against a real PostgreSQL: the same role key,
 * customer slug and SSH key fingerprint exist there under different ids. The
 * customer, its member, the member's role, the per-server access and every
 * server's kind and profile must come across — none silently skipped.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("config export → import round trip (PostgreSQL)", () => {
	const p = `rt-${randomUUID().slice(0, 8)}`;
	const admin = { userId: `${p}-admin`, username: `${p}-admin`, roles: ["admin" as const], mustChangePassword: false, currentTeamId: null };
	let file: ExportFile;

	const cleanup = async () => {
		await prisma.commandTemplate.deleteMany({ where: { id: { startsWith: p } } });
		await prisma.playbook.deleteMany({ where: { id: { startsWith: p } } });
		await prisma.announcement.deleteMany({ where: { id: { startsWith: p } } });
		await prisma.snippet.deleteMany({ where: { id: { startsWith: p } } });
		await prisma.userServerAccess.deleteMany({ where: { userId: { startsWith: p } } });
		await prisma.storageNode.deleteMany({ where: { id: { startsWith: p } } });
		await prisma.server.deleteMany({ where: { id: { startsWith: p } } });
		await prisma.sshKey.deleteMany({ where: { id: { startsWith: p } } });
		await prisma.teamMember.deleteMany({ where: { userId: { startsWith: p } } });
		await prisma.user.deleteMany({ where: { id: { startsWith: p } } });
		await prisma.team.deleteMany({ where: { id: { startsWith: p } } });
		await prisma.role.deleteMany({ where: { id: { startsWith: p } } });
	};

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("Config round-trip integration requires an isolated loopback audit/test database");
		}
		await syncBuiltinIdentityTemplates();
		// ── The source instance ──
		await prisma.role.create({ data: { id: `${p}-role-src`, key: `${p}-ops`, name: "Ops" } });
		await prisma.team.create({ data: { id: `${p}-team-src`, slug: `${p}-acme`, name: "Acme" } });
		await prisma.user.create({ data: { id: `${p}-user`, username: `${p}-user`, passwordHash: "hash", roles: { create: { roleId: `${p}-role-src` } },
			twoFactorEnabled: true, twoFactorSecret: "enc:totp", twoFactorRecoveryCodes: ["hash-1", "hash-2"],
			teamMembership: { create: { teamId: `${p}-team-src`, identityTemplateId: "identity:customer_admin" } } } });
		await prisma.sshKey.create({ data: { id: `${p}-key-src`, name: "deploy", fingerprint: `SHA256:${p}`, publicKey: "ssh-ed25519 AAAA", privateKey: "enc:key", teamId: `${p}-team-src` } });
		await prisma.server.create({ data: { id: `${p}-win`, name: `${p}-win`, host: `${p}-win.test`, port: 3389, username: "Administrator", teamId: `${p}-team-src`,
			operatingSystem: "WINDOWS", managementMode: "AGENT", connectionType: "PASSWORD", origin: "CUSTOMER", rdpDomain: "CORP", rdpPassword: "enc:rdp",
			rdpCertificateSha256: "a".repeat(64), hostKeySha256: "SHA256:win", costAutoSync: true, costMonthlyAmount: "12.50", trafficQuotaBytes: BigInt(1024) } });
		await prisma.server.create({ data: { id: `${p}-linux`, name: `${p}-linux`, host: `${p}-linux.test`, username: "root", teamId: `${p}-team-src`,
			connectionType: "SSH_KEY", sshKeyId: `${p}-key-src`, hostKeySha256: "SHA256:linux" } });
		await prisma.userServerAccess.create({ data: { userId: `${p}-user`, serverId: `${p}-linux`, canRead: true, canConnect: true } });
		await prisma.storageNode.create({ data: { id: `${p}-dav`, name: `${p}-dav`, driver: "WEBDAV", basePath: "/", teamId: `${p}-team-src`, webdavConfigEncrypted: "enc:dav" } });
		await prisma.storageNode.create({ data: { id: `${p}-sftp`, name: `${p}-sftp`, driver: "SFTP", basePath: "/srv", host: "sftp.test", teamId: `${p}-team-src`, hostKeySha256: "SHA256:sftp" } });

		// Made by an administrator who is not part of the customer.
		await prisma.user.create({ data: { id: `${p}-maker`, username: `${p}-maker`, passwordHash: "hash" } });
		await prisma.commandTemplate.create({ data: { id: `${p}-tpl`, name: `${p}-restart`, command: "systemctl restart app", teamId: `${p}-team-src`, createdById: `${p}-maker` } });
		await prisma.playbook.create({ data: { id: `${p}-pb`, name: `${p}-heal`, triggerType: "manual", triggerConfig: {}, steps: [], teamId: `${p}-team-src`, createdById: `${p}-maker` } });
		await prisma.announcement.create({ data: { id: `${p}-ann`, title: `${p}-notice`, body: "maintenance", createdBy: `${p}-maker` } });
		await prisma.snippet.create({ data: { id: `${p}-snip`, title: `${p}-snippet`, content: "echo ok", createdBy: `${p}-maker` } });

		const exported = await buildExportFile({ session: admin as never, mode: "full", scope: "global", sourceDomain: "source.test" });
		// As uploaded: JSON, validated by the import schema; only this test's rows.
		const parsed = exportFileSchema.parse(JSON.parse(JSON.stringify(exported)));
		const ours = <T>(rows: T[]) => rows.filter((row) => JSON.stringify(row).includes(p));
		file = { ...parsed, tables: Object.fromEntries(Object.entries(parsed.tables).map(([name, rows]) => [name,
			name === "identityTemplates" ? (rows as Array<{ id: string }>).filter((row) => row.id === "identity:customer_admin") : ours(rows as unknown[])])) as ExportFile["tables"] };

		// ── The target instance: same business keys, other ids ──
		await cleanup();
		await prisma.role.create({ data: { id: `${p}-role-dst`, key: `${p}-ops`, name: "Ops" } });
		await prisma.team.create({ data: { id: `${p}-team-dst`, slug: `${p}-acme`, name: "Acme" } });
		await prisma.sshKey.create({ data: { id: `${p}-key-dst`, name: "deploy", fingerprint: `SHA256:${p}`, publicKey: "ssh-ed25519 AAAA" } });
	}, 60_000);
	afterAll(async () => {
		await cleanup();
		await closeAdvisoryLockPoolForTests();
		await prisma.$disconnect();
	});

	it("exports the customer, its member and the servers' profiles", () => {
		expect(file.tables.teams.map((team) => team.slug)).toEqual([`${p}-acme`]);
		expect(file.tables.teamMembers).toEqual([expect.objectContaining({ userId: `${p}-user`, identityTemplateId: "identity:customer_admin" })]);
		expect(file.tables.servers.find((server) => server.id === `${p}-win`)).toMatchObject({ operatingSystem: "WINDOWS", managementMode: "AGENT", rdpPassword: "enc:rdp" });
	});

	it("imports into an instance whose objects carry other ids, keeping every link", async () => {
		const result = await executeImport(file, { dryRun: false, overwriteExisting: false, importUsers: true, importSettings: false });
		expect(result).toMatchObject({ errors: [] });
		expect(result.rolledBack).toBeUndefined();

		const user = await prisma.user.findUniqueOrThrow({ where: { id: `${p}-user` }, include: { roles: true, teamMembership: true } });
		expect(user.roles.map((role) => role.roleId)).toEqual([`${p}-role-dst`]);
		expect(user.teamMembership).toMatchObject({ teamId: `${p}-team-dst`, identityTemplateId: "identity:customer_admin" });

		const windows = await prisma.server.findUniqueOrThrow({ where: { id: `${p}-win` } });
		expect(windows).toMatchObject({ teamId: `${p}-team-dst`, operatingSystem: "WINDOWS", managementMode: "AGENT", origin: "CUSTOMER", rdpDomain: "CORP",
			rdpPassword: "enc:rdp", rdpCertificateSha256: "a".repeat(64), hostKeySha256: "SHA256:win", costAutoSync: true, trafficQuotaBytes: BigInt(1024) });
		expect(windows.costMonthlyAmount?.toFixed(2)).toBe("12.50");
		const linux = await prisma.server.findUniqueOrThrow({ where: { id: `${p}-linux` } });
		expect(linux).toMatchObject({ teamId: `${p}-team-dst`, sshKeyId: `${p}-key-dst`, hostKeySha256: "SHA256:linux" });
		expect(await prisma.userServerAccess.findUnique({ where: { userId_serverId: { userId: `${p}-user`, serverId: `${p}-linux` } } })).toMatchObject({ canConnect: true });
		// A WebDAV node keeps its endpoint, an SFTP node its host-key pin, a 2FA account its recovery codes.
		expect(await prisma.storageNode.findUniqueOrThrow({ where: { id: `${p}-dav` } })).toMatchObject({ teamId: `${p}-team-dst`, webdavConfigEncrypted: "enc:dav" });
		expect(await prisma.storageNode.findUniqueOrThrow({ where: { id: `${p}-sftp` } })).toMatchObject({ hostKeySha256: "SHA256:sftp" });
		expect(await prisma.user.findUniqueOrThrow({ where: { id: `${p}-user` } })).toMatchObject({ twoFactorSecret: "enc:totp", twoFactorRecoveryCodes: ["hash-1", "hash-2"] });
		// Nothing duplicated under the source ids.
		expect(await prisma.team.count({ where: { id: `${p}-team-src` } })).toBe(0);
		expect(await prisma.role.count({ where: { id: `${p}-role-src` } })).toBe(0);
	});

	it("imports templates, playbooks, announcements and snippets whose creator is not on this instance (H-1)", async () => {
		// A customer-scoped export leaves out the administrator who made the
		// customer's templates: one missing creator rolled the whole import back.
		const ghost = `${p}-ghost`;
		const tables = file.tables;
		expect(tables.commandTemplates.length + tables.playbooks.length + tables.announcements.length + tables.snippets.length).toBe(4);
		const variant: ExportFile = { ...file, tables: { ...tables,
			commandTemplates: tables.commandTemplates.map((row) => ({ ...row, id: `${row.id}-y`, name: `${row.name}-y`, createdById: ghost })),
			playbooks: tables.playbooks.map((row) => ({ ...row, id: `${row.id}-y`, name: `${row.name}-y`, createdById: ghost })),
			announcements: tables.announcements.map((row) => ({ ...row, id: `${row.id}-y`, createdBy: ghost })),
			snippets: tables.snippets.map((row) => ({ ...row, id: `${row.id}-y`, createdBy: ghost })),
		} };
		const result = await executeImport(variant, { dryRun: false, overwriteExisting: false, importUsers: true, importSettings: false });
		expect(result.errors).toEqual([]);
		expect(result.rolledBack).toBeUndefined();
		expect(await prisma.commandTemplate.findUniqueOrThrow({ where: { id: `${p}-tpl-y` } })).toMatchObject({ createdById: null });
		expect(await prisma.playbook.findUniqueOrThrow({ where: { id: `${p}-pb-y` } })).toMatchObject({ createdById: null });
		expect(await prisma.announcement.findUniqueOrThrow({ where: { id: `${p}-ann-y` } })).toMatchObject({ createdBy: null });
		expect(await prisma.snippet.findUniqueOrThrow({ where: { id: `${p}-snip-y` } })).toMatchObject({ createdBy: null });
	});

	it("does not import a two-factor flag without its secret (standard export)", async () => {
		const standardUser = { ...file.tables.users.find((user) => user.id === `${p}-user`)!, id: `${p}-std`, username: `${p}-std`, passwordHash: null, twoFactorSecret: null, twoFactorRecoveryCodes: null };
		expect(standardUser.twoFactorEnabled).toBe(true);
		const result = await executeImport({ ...file, tables: { ...file.tables, users: [standardUser], userRoles: [], teamMembers: [], userServerAccess: [], userStorageAccess: [] } }, { dryRun: false, overwriteExisting: false, importUsers: true, importSettings: false });
		expect(result.errors).toEqual([]);
		expect(await prisma.user.findUniqueOrThrow({ where: { id: `${p}-std` } })).toMatchObject({ twoFactorEnabled: false, twoFactorSecret: null });
	});

	it("refuses, with a clear error, a package whose resources name customers that exist nowhere", async () => {
		const orphan: ExportFile = { ...file, tables: { ...file.tables, teams: [], servers: file.tables.servers.map((server) => ({ ...server, id: `${server.id}-x`, teamId: `${p}-team-gone` })) } };
		const result = await executeImport(orphan, { dryRun: false, overwriteExisting: false, importUsers: true, importSettings: false });
		expect(result.rolledBack).toBe(true);
		expect(result.errors.join(" ")).toContain(`${p}-team-gone`);
		expect(await prisma.server.count({ where: { id: { endsWith: "-x", startsWith: p } } })).toBe(0);
	});
});
