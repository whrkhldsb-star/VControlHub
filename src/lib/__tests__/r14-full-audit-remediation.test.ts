import { describe, expect, it } from "vitest";

import { canRouteValidateBearerToken } from "@/lib/auth/bearer-route-policy";
import { parseBillingCsvRows } from "@/lib/cost/cloud-billing/adapters";
import { buildFileProxyScript } from "@/lib/server/file-proxy-script";
import { isLocalHostLiteral } from "@/lib/server/service-internals";
import { isProtectedLoginControlPath } from "@/lib/ssh/sftp-access-control";
import { S3Client } from "@/lib/storage/offsite/s3-client";
import { validateOffsiteConfigForUse } from "@/lib/storage/offsite/schema";

describe("Round 14 full-system audit regressions", () => {
	it("restricts edge Bearer pass-through strictly to routes and methods that validate API tokens", () => {
		expect(canRouteValidateBearerToken("/api/servers", "GET")).toBe(true);
		expect(canRouteValidateBearerToken("/api/webdav/node_1/docs/file.txt", "PUT")).toBe(true);
		expect(canRouteValidateBearerToken("/api/images/upload", "POST")).toBe(true);
		expect(canRouteValidateBearerToken("/api/status", "GET")).toBe(true);

		expect(canRouteValidateBearerToken("/api/users", "POST")).toBe(false);
		expect(canRouteValidateBearerToken("/api/teams", "PATCH")).toBe(false);
		expect(canRouteValidateBearerToken("/api/backups", "POST")).toBe(false);
		expect(canRouteValidateBearerToken("/api/system/export", "POST")).toBe(false);
	});

	it("blocks mutating protected login-control ancestors and Windows trailing-dot/8.3 aliases", () => {
		// .config is an ancestor of .config/systemd and .config/autostart, so mutating/deleting it is blocked.
		expect(isProtectedLoginControlPath("/home/ubuntu/.config", "/home/ubuntu", false)).toBe(true);
		expect(isProtectedLoginControlPath("/home/ubuntu/.config/systemd", "/home/ubuntu", false)).toBe(true);
		expect(isProtectedLoginControlPath("/home/ubuntu/projects/app", "/home/ubuntu", false)).toBe(false);

		// Windows NTFS trailing dots/spaces and 8.3 short-name segments
		expect(isProtectedLoginControlPath("C:/Users/alice/.ssh./authorized_keys", "C:/Users/alice", true)).toBe(true);
		expect(isProtectedLoginControlPath("C:/Users/alice/.bashrc .", "C:/Users/alice", true)).toBe(true);
		expect(isProtectedLoginControlPath("C:/Users/alice/BASHRC~1", "C:/Users/alice", true)).toBe(true);
	});

	it("recognizes expanded local, link-local, metadata, and IPv4-mapped loopback literals", () => {
		expect(isLocalHostLiteral("127.0.0.1")).toBe(true);
		expect(isLocalHostLiteral("0.0.0.0")).toBe(true);
		expect(isLocalHostLiteral("169.254.169.254")).toBe(true);
		expect(isLocalHostLiteral("::ffff:127.0.0.1")).toBe(true);
		expect(isLocalHostLiteral("[fe80::1]")).toBe(true);
		expect(isLocalHostLiteral("fd00:ec2::254")).toBe(true);
		expect(isLocalHostLiteral("sub.localhost")).toBe(true);

		expect(isLocalHostLiteral("203.0.113.25")).toBe(false);
		expect(isLocalHostLiteral("vps.example.com")).toBe(false);
	});

	it("rejects unsafe S3 bucket names and blocks loopback/IMDS offsite endpoints", () => {
		expect(
			validateOffsiteConfigForUse({
				enabled: true,
				provider: "s3",
				endpoint: "https://s3.example.com",
				region: "us-east-1",
				bucket: "../admin-bucket",
				accessKeyId: "AKIAEXAMPLE",
				secretAccessKey: "secret",
				pathPrefix: "vcontrolhub/",
				dailyWindowHour: 3,
				retentionDays: 30,
				failureAlertRecipient: "",
			}).length,
		).toBeGreaterThan(0);

		expect(
			validateOffsiteConfigForUse({
				enabled: true,
				provider: "minio",
				endpoint: "https://127.0.0.1:9000",
				region: "us-east-1",
				bucket: "valid-bucket-01",
				accessKeyId: "AKIAEXAMPLE",
				secretAccessKey: "secret",
				pathPrefix: "vcontrolhub/",
				dailyWindowHour: 3,
				retentionDays: 30,
				failureAlertRecipient: "",
			}).length,
		).toBeGreaterThan(0);

		expect(
			() =>
				new S3Client({
					endpoint: "https://169.254.169.254",
					region: "us-east-1",
					bucket: "valid-bucket-01",
					accessKeyId: "AKIAIOSFODNN7EXAMPLE",
					secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
				}),
		).toThrow();
	});

	it("strips NUL bytes from cloud-billing CSV cells before persistence", () => {
		const csv = "date,amount,currency,product,notes\n2026-11-01,12.50,USD,EC2\u0000Instance,monthly\u0000bill\n";
		const parsed = parseBillingCsvRows(csv, {
			currency: "USD",
			providerLabel: "AWS",
		});
		expect(parsed.items).toHaveLength(1);
		expect(parsed.items[0]?.productCode).not.toContain("\u0000");
		expect(parsed.items[0]?.notes).not.toContain("\u0000");
	});

	it("pins direct-gateway file opens with CANONICAL_ROOT, O_NOFOLLOW, and /proc/self/fd verification", () => {
		const script = buildFileProxyScript({
			accessToken: "tok_test",
			expiresAtMs: Date.now() + 60_000,
			serveDir: "/srv/storage",
			port: 19090,
			allowedOrigin: "https://hub.example.com",
		});
		expect(script).toContain("CANONICAL_ROOT = os.path.realpath(SERVE_DIR)");
		expect(script).toContain("O_NOFOLLOW");
		expect(script).toContain("dir_fd=parent");
		expect(script).toContain("/proc/self/fd/");
		expect(script).toContain("def list_directory(self, path):");
	});
});
