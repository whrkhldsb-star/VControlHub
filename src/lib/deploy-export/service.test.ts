import { describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { deploymentExport: { create: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { buildPortableDeploymentPackage } = await import("./service");

describe("deployment export service", () => {
	it("builds portable templates with placeholders, custom branding, and no secrets", () => {
		const pkg = buildPortableDeploymentPackage({ domain: "console.example.test", appName: "my-console" });
		const text = JSON.stringify(pkg.files);
		expect(text).toContain("REPLACE_WITH_DATABASE_URL");
		expect(text).toContain("AUTH_SESSION_SECRET");
		expect(text).toContain("ENCRYPTION_KEY");
		expect(text).toContain("SSH_WS_SECRET");
		expect(text).toContain("REPLACE_WITH_A_RANDOM_SECRET");
		expect(text).toContain("my-console-next.service");
		expect(text).toContain("my-console-ssh-ws.service");
		expect(text).toContain("my-console_session");
		expect(text).toContain("console.example.test");
		expect(text).toContain("Caddyfile");
		expect(text).toContain("SSH_WS_ALLOWED_ORIGINS");
		expect(text).not.toContain("whrkhldsb.qzz.io");
		expect(text).not.toContain("whrkhldsb-next.service");
		expect(text).not.toMatch(/postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i);
		expect(text).not.toMatch(/BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY/);
		// Each dangerous env flag must appear in the env template set to "false"
		const envFile = pkg.files["env.production.example"];
		for (const flag of pkg.manifest.dangerousEnvFlags) {
			expect(envFile).toContain(`${flag}="false"`);
		}
	});

	it("rejects unsafe domain and app name before generating executable templates", () => {
		expect(() => buildPortableDeploymentPackage({ domain: "good.com\nrespond hacked" })).toThrow(/域名/);
		expect(() => buildPortableDeploymentPackage({ appName: "bad;rm-rf" })).toThrow(/应用名称/);
	});
});
