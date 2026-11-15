// @vitest-environment node
import { describe, expect, it } from "vitest";

import { KEPT_ENV_KEYS, clearDeploymentEnv, deploymentEnvKeys } from "../deployment-env";

describe("the deployment's environment in tests", () => {
	const keys = deploymentEnvKeys();

	it("covers what an installation configures", () => {
		for (const key of ["AUTH_SESSION_SECRET", "TRUSTED_PROXY_HOPS", "ENCRYPTION_KEY", "APP_TIME_ZONE", "REDIS_URL", "BACKUP_COMMAND_TIMEOUT_MINUTES", "AI_PROVIDER_PRIVATE_HOSTS", "DOMAIN"]) {
			expect(keys.has(key), key).toBe(true);
		}
		expect(keys.size).toBeGreaterThan(120);
	});

	it("keeps the database the integration tests use and what Vitest sets", () => {
		for (const key of KEPT_ENV_KEYS) expect(keys.has(key), key).toBe(false);
		expect(keys.has("RUN_DATABASE_INTEGRATION_TESTS")).toBe(false);
		expect(keys.has("PATH")).toBe(false);
	});

	it("removes them before a test file runs", () => {
		const env = { AUTH_SESSION_SECRET: "from-the-shell", TRUSTED_PROXY_HOPS: "1", DATABASE_URL: "postgresql://test", NODE_ENV: "test", PATH: "/usr/bin" } as NodeJS.ProcessEnv;
		expect(clearDeploymentEnv(env, keys).sort()).toEqual(["AUTH_SESSION_SECRET", "TRUSTED_PROXY_HOPS"]);
		expect(env).toEqual({ DATABASE_URL: "postgresql://test", NODE_ENV: "test", PATH: "/usr/bin" });
		// This file ran after the setup did the same to the real environment.
		expect(process.env.AUTH_SESSION_SECRET).toBeUndefined();
	});
});
