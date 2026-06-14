import { createLogger } from "@/lib/logging";
import { config } from "@/lib/config/env";

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
