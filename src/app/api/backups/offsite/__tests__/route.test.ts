/**
 * TR-007 M03: /api/backups/offsite 路由测试 — GET / POST (config 局部更新) 行为。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		loadOffsiteConfig: vi.fn(),
		saveOffsiteConfig: vi.fn(),
	},
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));

vi.mock("@/lib/storage/offsite/service", () => ({
	loadOffsiteConfig: mocks.loadOffsiteConfig,
	saveOffsiteConfig: mocks.saveOffsiteConfig,
}));

const route = await import("../route");

const SAMPLE_CONFIG = {
	enabled: false,
	provider: "s3" as const,
	endpoint: "",
	region: "auto",
	bucket: "",
	accessKeyId: "",
	secretAccessKey: "supersecret",
	pathPrefix: "vcontrolhub-backups/",
	dailyWindowHour: 3,
	retentionDays: 30,
	failureAlertRecipient: "",
};

describe("/api/backups/offsite", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({
			session: { userId: "u1", username: "alice", user: { id: "u1" } },
		});
		mocks.loadOffsiteConfig.mockResolvedValue(SAMPLE_CONFIG);
		mocks.saveOffsiteConfig.mockImplementation(async (update: Record<string, unknown>) => ({
			...SAMPLE_CONFIG,
			...update,
		}));
	});

	it("GET masks secretAccessKey and returns config", async () => {
		const res = await route.GET(new Request("http://local/api/backups/offsite"));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.config).toEqual({
			...SAMPLE_CONFIG,
			secretAccessKey: "***",
		});
		// Make sure the actual secret is never in the response body
		expect(JSON.stringify(body)).not.toContain("supersecret");
	});

	it("POST accepts a partial update and returns masked config", async () => {
		const res = await route.POST(
			new Request("http://local/api/backups/offsite", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					enabled: true,
					bucket: "my-bucket",
					region: "us-east-1",
				}),
			}),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(mocks.saveOffsiteConfig).toHaveBeenCalledWith({
			enabled: true,
			bucket: "my-bucket",
			region: "us-east-1",
		});
		expect(body.config.secretAccessKey).toBe("***");
	});

	it("POST validates payload: rejects unknown keys", async () => {
		const res = await route.POST(
			new Request("http://local/api/backups/offsite", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					enabled: true,
					notARealKey: "x",
				}),
			}),
		);
		expect(res.status).toBe(400);
		expect(mocks.saveOffsiteConfig).not.toHaveBeenCalled();
	});

	it("POST validates dailyWindowHour range", async () => {
		const res = await route.POST(
			new Request("http://local/api/backups/offsite", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ dailyWindowHour: 24 }),
			}),
		);
		expect(res.status).toBe(400);
		expect(mocks.saveOffsiteConfig).not.toHaveBeenCalled();
	});

	it("POST validates retentionDays lower bound", async () => {
		const res = await route.POST(
			new Request("http://local/api/backups/offsite", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ retentionDays: 0 }),
			}),
		);
		expect(res.status).toBe(400);
		expect(mocks.saveOffsiteConfig).not.toHaveBeenCalled();
	});
});
