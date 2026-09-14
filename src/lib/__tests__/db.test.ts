// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("database driver pool configuration", () => {
	beforeEach(() => {
		vi.resetModules();
		delete global.__appPrisma__;
		delete global.__appPrismaAdapter__;
		vi.stubEnv("DATABASE_URL", "postgresql://test:test@127.0.0.1:5432/unused");
		vi.stubEnv("DB_POOL_SIZE", "4");
		vi.stubEnv("DB_CONNECTION_LIMIT", "3");
		vi.stubEnv("DB_POOL_IDLE_TIMEOUT_MS", "42000");
	});

	afterEach(async () => {
		await global.__appPrisma__?.$disconnect();
		delete global.__appPrisma__;
		delete global.__appPrismaAdapter__;
		vi.unstubAllEnvs();
	});

	async function driverOptions() {
		const { prisma } = await import("../db");
		// Accessing the lazy client constructs the adapter without opening a socket.
		void prisma.$disconnect;
		const adapter = await global.__appPrismaAdapter__!.connect();
		try { return adapter.underlyingDriver().options; }
		finally { await adapter.dispose(); }
	}

	it("applies limits to the actual pg pool", async () => {
		expect(await driverOptions()).toMatchObject({ max: 3, idleTimeoutMillis: 42000 });
	});

	it("honors existing URL overrides and permits disabling idle eviction", async () => {
		vi.stubEnv("DATABASE_URL", "postgresql://test:test@127.0.0.1:5432/unused?pool_max=2&connection_limit=5&pool_idle_timeout=0");
		expect(await driverOptions()).toMatchObject({ max: 2, idleTimeoutMillis: 0 });
	});

	it.each(["pool_max=0", "connection_limit=-1", "pool_max=1.5", "pool_idle_timeout=NaN"])("rejects invalid pool options: %s", async (query) => {
		vi.stubEnv("DATABASE_URL", `postgresql://test:test@127.0.0.1:5432/unused?${query}`);
		await expect(driverOptions()).rejects.toThrow("Invalid database pool option");
	});
});
