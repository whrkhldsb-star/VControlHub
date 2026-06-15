/**
 * Centralised environment-variable layer (TR-035).
 *
 * Every `process.env.X` read in non-startup code should go through this
 * module. Goals:
 *   1. Single source of truth for variable names — rename = touch one file.
 *   2. Typed access (numbers, booleans parsed once with sane errors).
 *   3. Per-namespace grouping (`config.auth.*`, `config.ssh.*`, …) so call
 *      sites read like prose.
 *   4. Lazy evaluation — values are computed on first access so tests can
 *      mutate `process.env` before importing consumers.
 *
 * Allowed direct `process.env` reads (kept by design):
 *   - `lib/config/env.ts` itself (this file).
 *   - `prisma/seed.ts` (one-shot startup script).
 *   - `instrumentation.ts` (Next.js bootstrap hook).
 *   - Test files that intentionally simulate env (look for `__tests__`).
 *
 * Adding a new variable:
 *   1. Add a getter under the right namespace below.
 *   2. Document the variable in `.env.example`.
 *   3. Replace `process.env.X` call sites with `config.<ns>.<name>`.
 */

// ── Helpers ──────────────────────────────────────────────────────

function readString(name: string, fallback?: string): string {
	const raw = process.env[name];
	if (raw === undefined || raw === "") {
		if (fallback !== undefined) return fallback;
		throw new Error(`Missing required env var: ${name}`);
	}
	return raw;
}

function readOptionalString(name: string): string | undefined {
	const raw = process.env[name];
	return raw === undefined || raw === "" ? undefined : raw;
}

function readInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n)) {
		throw new Error(`Invalid integer for env ${name}: "${raw}"`);
	}
	return n;
}

function readBool(name: string, fallback: boolean): boolean {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const lc = raw.toLowerCase();
	if (lc === "true" || lc === "1" || lc === "yes") return true;
	if (lc === "false" || lc === "0" || lc === "no") return false;
	throw new Error(`Invalid boolean for env ${name}: "${raw}"`);
}

function readList(name: string, fallback: string[] = []): string[] {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// ── Namespaced configuration ─────────────────────────────────────

export const config = {
	/** Runtime metadata. */
	get nodeEnv(): "development" | "production" | "test" {
		const raw = process.env.NODE_ENV;
		if (raw === "production" || raw === "test") return raw;
		return "development";
	},
	get isProduction(): boolean { return this.nodeEnv === "production"; },
	get isDevelopment(): boolean { return this.nodeEnv === "development"; },
	get isTest(): boolean { return this.nodeEnv === "test"; },

	/** Database. */
	db: {
		get url(): string { return readString("DATABASE_URL"); },
		get poolSize(): number { return readInt("DB_POOL_SIZE", 10); },
		get poolIdleTimeoutMs(): number { return readInt("DB_POOL_IDLE_TIMEOUT_MS", 30_000); },
	},

	/** Redis (optional — tests / dev may not have it). */
	redis: {
		get url(): string | undefined { return readOptionalString("REDIS_URL"); },
	},

	/** Authentication & sessions. */
	auth: {
		get secret(): string {
			// Fallback chain: AUTH_SECRET → AUTH_SESSION_SECRET → NEXTAUTH_SECRET.
			return (
				readOptionalString("AUTH_SECRET") ??
				readOptionalString("AUTH_SESSION_SECRET") ??
				readString("NEXTAUTH_SECRET")
			);
		},
		get sessionTtlSeconds(): number { return readInt("AUTH_SESSION_TTL_SECONDS", 7 * 24 * 60 * 60); },
		get rememberSessionTtlSeconds(): number {
			return readInt("AUTH_REMEMBER_SESSION_TTL_SECONDS", 30 * 24 * 60 * 60);
		},
		get sessionCookieName(): string | undefined { return readOptionalString("AUTH_SESSION_COOKIE_NAME"); },
		get sessionAudience(): string | undefined { return readOptionalString("AUTH_SESSION_AUDIENCE"); },
		get sessionIssuer(): string | undefined { return readOptionalString("AUTH_SESSION_ISSUER"); },
		/**
		 * Strict AUTH_SESSION_SECRET accessor — returns undefined when unset.
		 * Callers handle the dev-fallback / production-error semantics. This
		 * keeps the read centralised without baking policy into the config
		 * layer (which would force tests to assert production-only behaviour).
		 */
		get sessionSecret(): string | undefined { return readOptionalString("AUTH_SESSION_SECRET"); },
		/**
		 * The AUTH_SECRET that storage / direct-access gateways use to sign
		 * share-link redirects. Falls back through AUTH_SECRET → NEXTAUTH_SECRET
		 * when the deployment doesn't override STORAGE_DIRECT_ACCESS_SECRET.
		 */
		get storageGatewaySecret(): string | undefined {
			return (
				readOptionalString("STORAGE_DIRECT_ACCESS_SECRET") ??
				readOptionalString("AUTH_SECRET") ??
				readOptionalString("NEXTAUTH_SECRET")
			);
		},
		get adminInitialPassword(): string | undefined { return readOptionalString("ADMIN_INITIAL_PASSWORD"); },
	},

	/** Field-level encryption (passwords, secrets, etc.). */
	crypto: {
		get encryptionKey(): string { return readString("ENCRYPTION_KEY"); },
	},

	/** Command execution worker / runtime. */
	command: {
		get heartbeatMs(): number { return readInt("COMMAND_EXECUTION_HEARTBEAT_MS", 5_000); },
		get timeoutMs(): number { return readInt("COMMAND_EXECUTION_TIMEOUT_MS", 60_000); },
		get outputLimitBytes(): number { return readInt("COMMAND_OUTPUT_LIMIT_BYTES", 1_048_576); },
		get reconcileIntervalMs(): number { return readInt("COMMAND_RECONCILE_INTERVAL_MS", 30_000); },
		get staleRunningAfterMs(): number { return readInt("COMMAND_STALE_RUNNING_AFTER_MS", 5 * 60_000); },
		get demoFallback(): boolean { return readBool("COMMAND_DEMO_FALLBACK", false); },
		get startWorkerInNext(): boolean { return readBool("VCONTROLHUB_START_COMMAND_WORKER_IN_NEXT", false); },
	},

	/** SSH / WebSocket proxy. */
	ssh: {
		get keepaliveIntervalMs(): number { return readInt("SSH_KEEPALIVE_INTERVAL_MS", 15_000); },
		get keepaliveCountMax(): number { return readInt("SSH_KEEPALIVE_COUNT_MAX", 4); },
		get wsAllowedOrigins(): string[] { return readList("SSH_WS_ALLOWED_ORIGINS"); },
		get wsHeartbeatIntervalMs(): number { return readInt("SSH_WS_HEARTBEAT_INTERVAL_MS", 30_000); },
		get wsMaxConnections(): number { return readInt("SSH_WS_MAX_CONNECTIONS", 50); },
		get wsSecret(): string | undefined { return readOptionalString("SSH_WS_SECRET"); },
	},

	/** Storage / direct-access gateway. */
	storage: {
		get directAccessSecret(): string | undefined { return readOptionalString("STORAGE_DIRECT_ACCESS_SECRET"); },
		get grantFallback(): boolean { return readBool("VCONTROLHUB_STORAGE_GRANT_FALLBACK", false); },
		get backupDir(): string | undefined { return readOptionalString("BACKUP_DIR"); },
		get imageUploadDir(): string | undefined { return readOptionalString("IMAGE_UPLOAD_DIR"); },
	},

	/** Media (image-bed thumbnails, transcodes). */
	media: {
		get thumbCacheDir(): string | undefined {
			const raw = process.env.MEDIA_THUMB_CACHE_DIR?.trim();
			return raw ? raw : undefined;
		},
	},

	/** App identity / hosting. */
	app: {
		get appDir(): string | undefined { return readOptionalString("APP_DIR"); },
		get appSlug(): string { return readString("APP_SLUG", "vcontrolhub"); },
		get hostname(): string | undefined { return readOptionalString("HOSTNAME"); },
		get nextHost(): string | undefined { return readOptionalString("NEXT_HOST"); },
		get port(): number { return readInt("PORT", 3000); },
		get demoMode(): boolean { return readBool("DEMO_MODE", false); },
		get publicDemoMode(): boolean { return readBool("NEXT_PUBLIC_DEMO_MODE", false); },
		get publicQuickServiceHost(): string | undefined { return readOptionalString("NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST"); },
	},

	/**
	 * Durable job concurrency (TR-001 T13b).
	 *
	 * All three caps default to 0 (= unlimited) so existing deployments
	 * keep working without any env change. Setting a positive value turns
	 * on a soft guard inside `claimNextJob`: when the in-flight count is
	 * already at the cap, the function returns `null` and the candidate
	 * job stays in PENDING until a slot frees. This is a soft guard — the
	 * check and the claim happen in the same transaction, but two workers
	 * can still momentarily race past the cap by one job each; the cost of
	 * a few extra in-flight dispatches is dwarfed by the simplicity of not
	 * needing explicit row-level locks.
	 */
	job: {
		get maxConcurrentGlobal(): number { return readInt("JOB_MAX_CONCURRENT_GLOBAL", 0); },
		get maxConcurrentPerUser(): number { return readInt("JOB_MAX_CONCURRENT_PER_USER", 0); },
		get maxConcurrentPerNode(): number { return readInt("JOB_MAX_CONCURRENT_PER_NODE", 0); },
	},
};

export type AppConfig = typeof config;
