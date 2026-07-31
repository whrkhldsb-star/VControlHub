import { Client } from "pg";
import bcrypt from "bcryptjs";

export const ISOLATED_E2E_USERNAME = "vcontrolhub_e2e";
export const ISOLATED_E2E_PASSWORD = "VControlHub-E2E-2026!";
export const ISOLATED_E2E_SERVER_ID = "e2e-isolated-server";
export const ISOLATED_E2E_STORAGE_ID = "e2e-isolated-storage";

function loadOptionalEnvLocal() {
	// CI injects DATABASE_URL via the workflow; local runs use .env.local.
	// Node's loadEnvFile throws ENOENT when the file is missing — swallow that only.
	try {
		process.loadEnvFile(`${process.cwd()}/.env.local`);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") throw error;
	}
}

function localConnectionString() {
	loadOptionalEnvLocal();
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) throw new Error("DATABASE_URL is required for isolated E2E accounts");
	const hostname = new URL(connectionString).hostname.toLowerCase();
	if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
		throw new Error("Isolated E2E accounts may only use a loopback DATABASE_URL");
	}
	return connectionString;
}

export async function createIsolatedE2eAccount() {
	if (process.env.E2E_ISOLATED_ACCOUNT !== "1") return;
	const client = new Client({ connectionString: localConnectionString() });
	await client.connect();
	try {
		const passwordHash = await bcrypt.hash(process.env.E2E_PASS ?? ISOLATED_E2E_PASSWORD, 10);
		await client.query("BEGIN");
		await client.query(
			`INSERT INTO "User" (id, username, "displayName", "passwordHash", status, "mustChangePassword", "createdAt", "updatedAt")
			 VALUES ('e2e-isolated-account', $1, 'Isolated E2E', $2, 'ACTIVE', false, NOW(), NOW())
			 ON CONFLICT (username) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", status = 'ACTIVE', "mustChangePassword" = false, "updatedAt" = NOW()`,
			[ISOLATED_E2E_USERNAME, passwordHash],
		);
		await client.query(
			`INSERT INTO "UserRole" ("userId", "roleId", "assignedAt")
			 SELECT u.id, r.id, NOW() FROM "User" u CROSS JOIN "Role" r
			 WHERE u.username = $1 AND r.key = 'admin'
			 ON CONFLICT ("userId", "roleId") DO NOTHING`,
			[ISOLATED_E2E_USERNAME],
		);
		await client.query(
			`INSERT INTO servers (id, name, host, port, username, password, tags, enabled, "connectionType", "createdAt", "updatedAt")
			 VALUES ($1, 'E2E unreachable VPS', '192.0.2.1', 22, 'root', 'e2e-not-used', ARRAY['e2e']::text[], true, 'PASSWORD', NOW(), NOW())
			 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, host = EXCLUDED.host, port = EXCLUDED.port,
			 username = EXCLUDED.username, password = EXCLUDED.password, "sshKeyId" = NULL,
			 tags = EXCLUDED.tags, enabled = true, "connectionType" = EXCLUDED."connectionType", "updatedAt" = NOW()`,
			[ISOLATED_E2E_SERVER_ID],
		);
		await client.query(
			`INSERT INTO "StorageNode" (id, name, driver, "isDefault", "basePath", "serverId", "healthStatus", "createdAt", "updatedAt")
			 VALUES ($1, 'E2E server storage', 'LOCAL', false, '/tmp/vcontrolhub-e2e-storage', $2, 'UNKNOWN', NOW(), NOW())
			 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, driver = EXCLUDED.driver,
			 "basePath" = EXCLUDED."basePath", "serverId" = EXCLUDED."serverId", "updatedAt" = NOW()`,
			[ISOLATED_E2E_STORAGE_ID, ISOLATED_E2E_SERVER_ID],
		);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		await client.end();
	}
}

export async function removeIsolatedE2eAccount() {
	if (process.env.E2E_ISOLATED_ACCOUNT !== "1") return;
	const client = new Client({ connectionString: localConnectionString() });
	await client.connect();
	try {
		await client.query("BEGIN");
		await client.query(`DELETE FROM media_items WHERE "relativePath" LIKE 'qa-media/%'`);
		await client.query(`DELETE FROM file_entries WHERE "relativePath" LIKE 'qa-media/%'`);
		await client.query(`DELETE FROM "User" WHERE username LIKE 'qa\\_%' ESCAPE '\\'`);
		await client.query(`DELETE FROM "User" WHERE username = $1`, [ISOLATED_E2E_USERNAME]);
		await client.query(`DELETE FROM "StorageNode" WHERE id = $1`, [ISOLATED_E2E_STORAGE_ID]);
		await client.query(`DELETE FROM servers WHERE id = $1`, [ISOLATED_E2E_SERVER_ID]);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		await client.end();
	}
}
