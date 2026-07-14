import { Client } from "pg";
import bcrypt from "bcryptjs";

export const ISOLATED_E2E_USERNAME = "vcontrolhub_e2e";
export const ISOLATED_E2E_PASSWORD = "VControlHub-E2E-2026!";

function localConnectionString() {
	process.loadEnvFile(`${process.cwd()}/.env.local`);
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
		await client.query(`DELETE FROM media_items WHERE "relativePath" LIKE 'qa-media/%'`);
		await client.query(`DELETE FROM file_entries WHERE "relativePath" LIKE 'qa-media/%'`);
		await client.query(`DELETE FROM "User" WHERE username LIKE 'qa\\_%' ESCAPE '\\'`);
		await client.query(`DELETE FROM "User" WHERE username = $1`, [ISOLATED_E2E_USERNAME]);
	} finally {
		await client.end();
	}
}
