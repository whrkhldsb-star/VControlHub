import { createHmac, randomBytes } from "node:crypto";

import type { BrowserContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";

export async function installDirectSession(context: BrowserContext) {
	process.loadEnvFile(`${process.cwd()}/.env.local`);
	const username = process.env.E2E_USER ?? "admin";
	const password = process.env.E2E_PASS ?? "admin123";
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) throw new Error("DATABASE_URL is required for direct E2E sessions");
	const trustLocalDbSession = process.env.E2E_TRUST_LOCAL_DB_SESSION === "1";
	if (trustLocalDbSession) {
		const hostname = new URL(connectionString).hostname.toLowerCase();
		if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
			throw new Error("E2E_TRUST_LOCAL_DB_SESSION only permits a loopback DATABASE_URL");
		}
	}
	const client = new Client({ connectionString });
	await client.connect();
	try {
		const result = await client.query<{
			id: string;
			username: string;
			passwordHash: string;
			mustChangePassword: boolean;
			currentTeamId: string | null;
			roles: string[];
		}>(`SELECT u.id, u.username, u."passwordHash", u."mustChangePassword", u."currentTeamId",
			COALESCE(array_agg(r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS roles
			FROM "User" u
			LEFT JOIN "UserRole" ur ON ur."userId" = u.id
			LEFT JOIN "Role" r ON r.id = ur."roleId"
			WHERE u.username = $1 AND u.status = 'ACTIVE'
			GROUP BY u.id`, [username]);
		const user = result.rows[0];
		if (!user || (!trustLocalDbSession && !(await bcrypt.compare(password, user.passwordHash)))) {
			throw new Error(`Unable to create E2E session for ${username}`);
		}
		const now = Date.now();
		const appSlug = process.env.APP_SLUG?.trim() || "vcontrolhub";
		const envelope = {
			userId: user.id,
			username: user.username,
			roles: user.roles,
			mustChangePassword: user.mustChangePassword,
			currentTeamId: user.currentTeamId,
			iss: process.env.AUTH_SESSION_ISSUER?.trim() || appSlug,
			aud: process.env.AUTH_SESSION_AUDIENCE?.trim() || `${appSlug}-console`,
			iat: now,
			exp: now + 60 * 60 * 1000,
		};
		const encoded = Buffer.from(JSON.stringify(envelope)).toString("base64url");
		const secret = process.env.AUTH_SESSION_SECRET;
		if (!secret) throw new Error("AUTH_SESSION_SECRET missing for direct E2E session");
		const token = `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
		const url = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
		await context.addCookies([
			{ name: process.env.AUTH_SESSION_COOKIE_NAME?.trim() || `${appSlug}_session`, value: token, url, httpOnly: true, sameSite: "Lax" },
			{ name: "csrf_token", value: randomBytes(32).toString("hex"), url, httpOnly: false, sameSite: "Lax" },
		]);
	} finally {
		await client.end();
	}
}
