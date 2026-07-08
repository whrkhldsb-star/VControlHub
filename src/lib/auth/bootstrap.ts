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
 | { ok: true; username: string }
 | { ok: false; reason: "no_admin" | "no_env_password" | "hash_mismatch"; message: string };

/**
 * TR-051: 启动时校验 ADMIN_INITIAL_PASSWORD (env) 与 DB 中 admin 用户的
 * passwordHash 是否一致。结果供 instrumentation 启动日志 + CLI 工具使用。
 * 此函数只读，不修改 DB。
 */
export async function verifyAdminPasswordConsistency(): Promise<AdminConsistencyResult> {
	const envPassword = config.auth.adminInitialPassword;
	if (!envPassword) {
		return { ok: false, reason: "no_env_password", message: "ADMIN_INITIAL_PASSWORD is not set" };
	}
	const admin = await prisma.user.findUnique({ where: { username: ADMIN_BOOTSTRAP.username } });
	if (!admin) {
		return { ok: false, reason: "no_admin", message: `User ${ADMIN_BOOTSTRAP.username} does not exist in DB` };
	}
	const matches = await verifyPassword(envPassword, admin.passwordHash);
	if (!matches) {
		return {
			ok: false,
			reason: "hash_mismatch",
			message: `ADMIN_INITIAL_PASSWORD does not match ${ADMIN_BOOTSTRAP.username}.passwordHash in DB (possibly from historical seed or manual password change). Manual fix: prisma db seed or reset admin password.`,
		};
	}
	return { ok: true, username: ADMIN_BOOTSTRAP.username };
}
