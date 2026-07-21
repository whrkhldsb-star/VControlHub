import { createLogger } from "@/lib/logging";
import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { verifyPassword } from "./password";

const logger = createLogger("auth:bootstrap");

export const ADMIN_BOOTSTRAP = {
 username: "admin",
 displayName: "Platform Admin",
 status: "PENDING_PASSWORD_RESET",
 mustChangePassword: true,
} as const;

/** Get initial admin password from env or fallback (only for seeding new DBs) */
export function getInitialAdminPassword(): string {
	const envPassword = config.auth.adminInitialPassword;
	if (!envPassword) {
		if (config.isProduction) {
			throw new Error("ADMIN_INITIAL_PASSWORD must be set in production for initial admin seeding.");
		}
		logger.warn("using default development admin password; set ADMIN_INITIAL_PASSWORD for production");
		return "changeme";
	}
	return envPassword;
}

export function getInitialAdminProfile() {
 return {
 username: ADMIN_BOOTSTRAP.username,
 displayName: ADMIN_BOOTSTRAP.displayName,
 status: ADMIN_BOOTSTRAP.status,
 mustChangePassword: ADMIN_BOOTSTRAP.mustChangePassword,
 };
}

export type AdminConsistencyResult =
	| { ok: true; username: string; mode: "bootstrap_match" | "rotated" }
	| { ok: false; reason: "no_admin" | "no_env_password" | "hash_mismatch"; message: string };

/**
 * TR-051: bootstrap / ops check for the platform admin credential.
 *
 * `ADMIN_INITIAL_PASSWORD` is **bootstrap-only** (seed + first login). After the
 * admin rotates the password in the UI (`mustChangePassword=false`), the env value
 * is intentionally allowed to diverge from the DB hash — that is normal product
 * behaviour, not a production outage.
 *
 * Failure modes that still matter:
 * - missing admin row
 * - missing env on a still-bootstrapping admin (mustChangePassword=true)
 * - env vs hash mismatch **while** the account is still on the initial password
 *
 * Read-only; never mutates DB.
 */
export async function verifyAdminPasswordConsistency(): Promise<AdminConsistencyResult> {
	const admin = await prisma.user.findUnique({
		where: { username: ADMIN_BOOTSTRAP.username },
		select: {
			passwordHash: true,
			mustChangePassword: true,
			status: true,
		},
	});
	if (!admin) {
		return {
			ok: false,
			reason: "no_admin",
			message: `User ${ADMIN_BOOTSTRAP.username} does not exist in DB`,
		};
	}

	// Password already rotated via UI / ops — env is no longer the source of truth.
	if (!admin.mustChangePassword) {
		return { ok: true, username: ADMIN_BOOTSTRAP.username, mode: "rotated" };
	}

	const envPassword = config.auth.adminInitialPassword;
	if (!envPassword) {
		return {
			ok: false,
			reason: "no_env_password",
			message:
				"ADMIN_INITIAL_PASSWORD is not set while admin still requires initial password rotation",
		};
	}

	const matches = await verifyPassword(envPassword, admin.passwordHash);
	if (!matches) {
		return {
			ok: false,
			reason: "hash_mismatch",
			message:
				`ADMIN_INITIAL_PASSWORD does not match ${ADMIN_BOOTSTRAP.username}.passwordHash while mustChangePassword=true ` +
				`(bootstrap seed drift). Fix: set ADMIN_INITIAL_PASSWORD to the current admin password, or reset admin via seed/ops.`,
		};
	}

	return { ok: true, username: ADMIN_BOOTSTRAP.username, mode: "bootstrap_match" };
}
