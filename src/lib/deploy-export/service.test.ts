import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
		expect(text).toContain("my-console-worker.service");
		expect(text).toContain("my-console-ssh-ws.service");
		expect(text).toContain("my-console_session");
		expect(text).toContain("console.example.test");
		expect(text).toContain("Caddyfile");
		expect(text).toContain("SSH_WS_ALLOWED_ORIGINS");
		expect(text).not.toContain("whrkhldsb.qzz.io");
		expect(text).not.toContain("whrkhldsb-next.service");
		expect(pkg.files["my-console-next.service"]).toContain("VCONTROLHUB_WORKERS_DISABLED=true");
		expect(pkg.files["my-console-worker.service"]).toContain("dist/worker.js");
		expect(text).not.toMatch(/postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i);
		expect(text).not.toMatch(/BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY/);
		// Each dangerous env flag must appear in the env template set to "false"
		const envFile = pkg.files["env.production.example"];
		for (const flag of pkg.manifest.dangerousEnvFlags) {
			expect(envFile).toContain(`${flag}="false"`);
		}
	});

	it("names the package after this instance's slug when no name is given", () => {
		// The display name "VControlHub" was the default and failed the
		// identifier rule: GET /api/deploy-export and an empty form both 400'd.
		vi.stubEnv("APP_NAME", "");
		vi.stubEnv("APP_SLUG", "");
		expect(buildPortableDeploymentPackage().manifest.appName).toBe("vcontrolhub");
		expect(buildPortableDeploymentPackage({ domain: "ops.example.test", appName: "" }).manifest.appName).toBe("vcontrolhub");
		vi.stubEnv("APP_NAME", "My Console");
		expect(buildPortableDeploymentPackage().manifest.appName).toBe("my-console");
		vi.stubEnv("APP_NAME", "运维平台");
		expect(buildPortableDeploymentPackage().manifest.appName).toBe("vcontrolhub");
		vi.unstubAllEnvs();
	});

	it("builds the runtime entry points its service units start", () => {
		const script = buildPortableDeploymentPackage({ appName: "my-console" }).files["deploy.sh"];
		const lines = script.split("\n");
		expect(lines).toContain("npm run build:runtime");
		expect(lines.indexOf("npm run build:runtime")).toBeGreaterThan(lines.indexOf("npm run build"));
	});

	it("rejects unsafe domain and app name before generating executable templates", () => {
		expect(() => buildPortableDeploymentPackage({ domain: "good.com\nrespond hacked" })).toThrow(/域名/);
		expect(() => buildPortableDeploymentPackage({ appName: "bad;rm-rf" })).toThrow(/应用名称/);
	});

	it("proxies SSH and remote desktop to the gateway and the rest to the app, on the ports its env template sets", () => {
		// {env.PORT} is Caddy's own environment: every request went to "127.0.0.1:" (502),
		// and /rdp, missing, reached Next.js instead of the gateway.
		const pkg = buildPortableDeploymentPackage({ domain: "console.example.com", appName: "my-console" });
		const caddyfile = pkg.files["Caddyfile.example"];
		expect(caddyfile).not.toMatch(/\{env\.|\{\$/);
		for (const route of ["/ssh", "/ssh/*", "/rdp"]) expect(caddyfile).toContain(`reverse_proxy ${route} 127.0.0.1:3001`);
		expect(caddyfile).toContain("reverse_proxy 127.0.0.1:3000");
		expect(pkg.files["env.production.example"]).toContain('SSH_WS_PORT="3001"');
		expect(pkg.files["env.production.example"]).toContain('PORT="3000"');
	});

	it("builds in the directory its service units run from", () => {
		const lines = buildPortableDeploymentPackage({ appName: "my-console" }).files["deploy.sh"].split("\n");
		expect(lines.indexOf('cd "$APP_DIR"')).toBeGreaterThan(-1);
		expect(lines.indexOf('cd "$APP_DIR"')).toBeLessThan(lines.indexOf("npm ci"));
	});

	let caddy = "";
	try { caddy = execFileSync("sh", ["-c", "command -v caddy"], { encoding: "utf8" }).trim(); } catch { caddy = ""; }
	it.skipIf(!caddy)("is a Caddyfile Caddy accepts, with those upstreams", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "vch-export-caddy-"));
		try {
			const file = path.join(dir, "Caddyfile");
			writeFileSync(file, buildPortableDeploymentPackage({ domain: "console.example.com" }).files["Caddyfile.example"]);
			const json = execFileSync(caddy, ["adapt", "--config", file, "--adapter", "caddyfile"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
			const dials = [...json.matchAll(/"dial":"([^"]+)"/g)].map((match) => match[1]);
			expect(new Set(dials)).toEqual(new Set(["127.0.0.1:3001", "127.0.0.1:3000"]));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
