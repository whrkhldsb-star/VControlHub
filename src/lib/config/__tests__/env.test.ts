import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { config } from "@/lib/config/env";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
	process.env = { ...ORIGINAL_ENV };
}

describe("lib/config/env", () => {
	beforeEach(() => {
		resetEnv();
	});
	afterEach(() => {
		resetEnv();
	});

	describe("nodeEnv", () => {
		// NODE_ENV is typed as a const string literal by Next.js, so we have to
		// route around the type checker to mutate it for these tests.
		const setNodeEnv = (v: string) => {
			Object.defineProperty(process.env, "NODE_ENV", {
				value: v,
				configurable: true,
				writable: true,
				enumerable: true,
			});
		};

		it("returns the configured value when valid", () => {
			setNodeEnv("production");
			expect(config.nodeEnv).toBe("production");
			expect(config.isProduction).toBe(true);
			expect(config.isDevelopment).toBe(false);
		});
		it("falls back to development for unknown values", () => {
			setNodeEnv("stage");
			expect(config.nodeEnv).toBe("development");
		});
		it("isTest reflects 'test'", () => {
			setNodeEnv("test");
			expect(config.isTest).toBe(true);
		});
	});

	describe("readString — required", () => {
		it("throws a friendly error when missing", () => {
			delete process.env.DATABASE_URL;
			expect(() => config.db.url).toThrow(/DATABASE_URL/);
		});
		it("returns the value when set", () => {
			process.env.DATABASE_URL = "postgres://x";
			expect(config.db.url).toBe("postgres://x");
		});
	});

	describe("readInt with fallback", () => {
		it("uses fallback when unset", () => {
			delete process.env.DB_POOL_SIZE;
			expect(config.db.poolSize).toBe(10);
		});
		it("parses a number", () => {
			process.env.DB_POOL_SIZE = "25";
			expect(config.db.poolSize).toBe(25);
		});
		it("throws on garbage", () => {
			process.env.DB_POOL_SIZE = "abc";
			expect(() => config.db.poolSize).toThrow(/Invalid integer/);
		});
		it("db.connectionLimit defaults to 10", () => {
			delete process.env.DB_CONNECTION_LIMIT;
			expect(config.db.connectionLimit).toBe(10);
		});
		it("db.connectionLimit reads env override", () => {
			process.env.DB_CONNECTION_LIMIT = "5";
			expect(config.db.connectionLimit).toBe(5);
		});
	});

	describe("readBool", () => {
		it("accepts true/false/1/0/yes/no", () => {
			process.env.DEMO_MODE = "true";
			expect(config.app.demoMode).toBe(true);
			process.env.DEMO_MODE = "0";
			expect(config.app.demoMode).toBe(false);
			process.env.DEMO_MODE = "YES";
			expect(config.app.demoMode).toBe(true);
		});
		it("falls back when unset", () => {
			delete process.env.DEMO_MODE;
			expect(config.app.demoMode).toBe(false);
		});
		it("throws on garbage", () => {
			process.env.DEMO_MODE = "maybe";
			expect(() => config.app.demoMode).toThrow(/Invalid boolean/);
		});
	});

	describe("readList", () => {
		it("splits comma list and trims", () => {
			process.env.SSH_WS_ALLOWED_ORIGINS = "https://a.com, https://b.com ,";
			expect(config.ssh.wsAllowedOrigins).toEqual([
				"https://a.com",
				"https://b.com",
			]);
		});
		it("returns [] when unset", () => {
			delete process.env.SSH_WS_ALLOWED_ORIGINS;
			expect(config.ssh.wsAllowedOrigins).toEqual([]);
		});
	});

	describe("auth.secret fallback chain", () => {
		it("prefers AUTH_SECRET", () => {
			process.env.AUTH_SECRET = "a";
			process.env.AUTH_SESSION_SECRET = "b";
			process.env.NEXTAUTH_SECRET = "c";
			expect(config.auth.secret).toBe("a");
		});
		it("falls back to AUTH_SESSION_SECRET", () => {
			delete process.env.AUTH_SECRET;
			process.env.AUTH_SESSION_SECRET = "b";
			process.env.NEXTAUTH_SECRET = "c";
			expect(config.auth.secret).toBe("b");
		});
		it("falls back to NEXTAUTH_SECRET", () => {
			delete process.env.AUTH_SECRET;
			delete process.env.AUTH_SESSION_SECRET;
			process.env.NEXTAUTH_SECRET = "c";
			expect(config.auth.secret).toBe("c");
		});
		it("throws when none set", () => {
			delete process.env.AUTH_SECRET;
			delete process.env.AUTH_SESSION_SECRET;
			delete process.env.NEXTAUTH_SECRET;
			expect(() => config.auth.secret).toThrow(/NEXTAUTH_SECRET/);
		});
	});

	describe("worker poll intervals", () => {
		it("commandExecutionIntervalMs defaults to 2000", () => {
			delete process.env.COMMAND_EXECUTION_INTERVAL_MS;
			expect(config.worker.commandExecutionIntervalMs).toBe(2_000);
		});
		it("commandExecutionIntervalMs reads env override", () => {
			process.env.COMMAND_EXECUTION_INTERVAL_MS = "500";
			expect(config.worker.commandExecutionIntervalMs).toBe(500);
		});
		it("downloadExecutionIntervalMs defaults to 5000", () => {
			delete process.env.DOWNLOAD_EXECUTION_INTERVAL_MS;
			expect(config.worker.downloadExecutionIntervalMs).toBe(5_000);
		});
		it("downloadExecutionIntervalMs reads env override", () => {
			process.env.DOWNLOAD_EXECUTION_INTERVAL_MS = "1000";
			expect(config.worker.downloadExecutionIntervalMs).toBe(1_000);
		});
	});

	describe("job defaults", () => {
		it("defaultMaxAttempts defaults to 3", () => {
			delete process.env.JOB_DEFAULT_MAX_ATTEMPTS;
			expect(config.job.defaultMaxAttempts).toBe(3);
		});
		it("defaultMaxAttempts reads env override", () => {
			process.env.JOB_DEFAULT_MAX_ATTEMPTS = "5";
			expect(config.job.defaultMaxAttempts).toBe(5);
		});
	});

	describe("optional values", () => {
		it("redis.url returns undefined when unset", () => {
			delete process.env.REDIS_URL;
			expect(config.redis.url).toBeUndefined();
		});
		it("returns string when set", () => {
			process.env.REDIS_URL = "redis://localhost:6379";
			expect(config.redis.url).toBe("redis://localhost:6379");
		});
	});
});
