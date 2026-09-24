import { createHmac, randomBytes } from "node:crypto";

import type { BrowserContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import type { RoleKey } from "../../src/lib/auth/rbac";
import { getAppSlug } from "../../src/lib/branding";

function loadOptionalEnvLocal() {
	// CI injects DATABASE_URL / AUTH_* via the workflow; local runs use .env.local.
	// Node's loadEnvFile throws ENOENT when the file is missing — swallow that only.
	try {
		process.loadEnvFile(`${process.cwd()}/.env.local`);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") throw error;
	}
}

export async function installDirectSession(context: BrowserContext, options: { username?: string } = {}) {
	loadOptionalEnvLocal();
	const username = options.username ?? process.env.E2E_DIRECT_USER ?? process.env.E2E_USER ?? "admin";
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
			roles: RoleKey[];
			sessionEpoch: number;
		}>(`SELECT u.id, u.username, u."passwordHash", u."mustChangePassword", u."currentTeamId", u."sessionEpoch",
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
		const appSlug = getAppSlug();
		const secret = process.env.AUTH_SESSION_SECRET;
		if (!secret) throw new Error("AUTH_SESSION_SECRET missing for direct E2E session");
		const now = Date.now();
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
			// Match the credential binding required by verifySessionToken.
			cfp: createHmac("sha256", secret).update(`session-credential:${user.passwordHash}`).digest("base64url").slice(0, 22),
			// Match the session-revocation epoch binding. verifySessionToken
			// rejects any token whose `sep` is older than User.sessionEpoch, and
			// a token minted without `sep` reads as 0 — so once a spec advances
			// the epoch (the 2FA enable/disable lifecycle does, twice), every
			// later direct session was rejected and the browser bounced to
			// /login. Always mint against the account's current epoch.
			sep: user.sessionEpoch ?? 0,
		};
		const encoded = Buffer.from(JSON.stringify(envelope)).toString("base64url");
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
