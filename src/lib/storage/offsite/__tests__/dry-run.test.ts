/**
 * TR-007 M03: runOffsiteDryRun() 测试。
 *
 * 不引真 S3; mock 整个 fetch 链路, 测 4 个 case:
 *   1. enabled=false  → { ok:false, reason:"offsite_disabled" }
 *   2. config 缺字段  → { ok:false, reason:"config_invalid", issues: [...] }
 *   3. PUT/HEAD/DELETE 全成功 → { ok:true, probeKey, latencyMs, ... }
 *   4. 远端 500      → 抛 S3Error
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		loadOffsiteConfig: vi.fn(),
	},
}));

vi.mock("../schema", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../schema")>();
	return {
		...actual,
		loadOffsiteConfig: mocks.loadOffsiteConfig,
	};
});

const { runOffsiteDryRun } = await import("../dry-run");
const { S3Error } = await import("../s3-client");

function makeFetchMock(handler: (req: { method: string; url: string }) => Response) {
	const calls: Array<{ method: string; url: string }> = [];
	const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
		calls.push({ method: String(init.method ?? "GET").toUpperCase(), url });
		return handler({ method: String(init.method ?? "GET").toUpperCase(), url });
	});
	return { fetchImpl, calls };
}

const ENABLED_CONFIG = {
	enabled: true,
	provider: "minio" as const,
	endpoint: "https://minio.example",
	region: "us-east-1",
	bucket: "backup-bucket",
	accessKeyId: "AKIAEXAMPLE",
	secretAccessKey: "secret",
	pathPrefix: "vcontrolhub-backups/",
	dailyWindowHour: 3,
	retentionDays: 30,
	failureAlertRecipient: "",
};

describe("runOffsiteDryRun", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns offsite_disabled when enabled=false (no fetch call)", async () => {
		mocks.loadOffsiteConfig.mockResolvedValue({ ...ENABLED_CONFIG, enabled: false });
		const result = await runOffsiteDryRun();
		expect(result).toEqual({ ok: false, reason: "offsite_disabled" });
	});

	it("returns config_invalid when required fields are blank", async () => {
		mocks.loadOffsiteConfig.mockResolvedValue({
			...ENABLED_CONFIG,
			bucket: "  ", // blank
			accessKeyId: "", // blank
		});
		const result = await runOffsiteDryRun();
		expect(result.ok).toBe(false);
		if (result.ok === false && result.reason === "config_invalid") {
			expect(result.issues.length).toBeGreaterThan(0);
			expect(result.issues.some((i) => i.toLowerCase().includes("bucket"))).toBe(true);
			expect(result.issues.some((i) => i.toLowerCase().includes("accesskeyid"))).toBe(true);
		} else {
			throw new Error("expected config_invalid result");
		}
	});

	it("returns ok=true on a clean PUT/HEAD/DELETE cycle", async () => {
		mocks.loadOffsiteConfig.mockResolvedValue(ENABLED_CONFIG);
		const { fetchImpl, calls } = makeFetchMock(({ method }) => {
			if (method === "PUT") return new Response("", { status: 200, headers: { etag: '"e"' } });
			if (method === "HEAD") return new Response("", { status: 200, headers: { etag: '"e"' } });
			if (method === "DELETE") return new Response(null, { status: 204 });
			return new Response("", { status: 200 });
		});
		// Inject fetchImpl into the S3Client constructed inside runOffsiteDryRun
		// by stubbing global fetch (S3Client falls back to globalThis.fetch).
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchImpl as unknown as typeof fetch;
		try {
			const result = await runOffsiteDryRun();
			expect(result.ok).toBe(true);
			if (result.ok === true) {
				expect(result.bucket).toBe("backup-bucket");
				expect(result.region).toBe("us-east-1");
				expect(result.endpoint).toBe("https://minio.example");
				expect(result.provider).toBe("minio");
				expect(result.probeKey).toMatch(/^vcontrolhub-backups\/_probe\/[a-f0-9]+\.probe$/);
				expect(result.latencyMs).toBeGreaterThanOrEqual(0);
			}
			// Verify the 3-step dance: PUT → HEAD → DELETE
			expect(calls.map((c) => c.method)).toEqual(["PUT", "HEAD", "DELETE"]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("throws S3Error on 500 from the remote during PUT", async () => {
		mocks.loadOffsiteConfig.mockResolvedValue(ENABLED_CONFIG);
		const fetchImpl = vi.fn(async () =>
			new Response("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>", { status: 500 }),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchImpl as unknown as typeof fetch;
		try {
			await expect(runOffsiteDryRun()).rejects.toBeInstanceOf(S3Error);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
