import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe.skipIf(process.platform === "win32")("the generated deploy.sh, run", () => {
	// npm and npx stand-ins record what each command was started with.
	function run(envFile: string | null) {
		const dir = mkdtempSync(path.join(tmpdir(), "vch-export-deploy-"));
		try {
			const bin = path.join(dir, "bin");
			const appDir = path.join(dir, "app");
			const log = path.join(dir, "calls.log");
			mkdirSync(bin);
			mkdirSync(appDir);
			for (const tool of ["npm", "npx"]) {
				writeFileSync(path.join(bin, tool), [
					"#!/bin/sh",
					`printf '%s\t%s\t%s\t%s\t%s\t%s\n' "${tool} $*" "\${DATABASE_URL-}" "\${SINGLE-}" "\${VCONTROLHUB_DEPLOY_BUILD-}" "\${NEXT_SYSTEMD_SERVICE-}" "$PWD" >> "${log}"`,
					"",
				].join("\n"));
				chmodSync(path.join(bin, tool), 0o755);
			}
			if (envFile !== null) writeFileSync(path.join(appDir, ".env.production"), envFile);
			const script = path.join(dir, "deploy.sh");
			writeFileSync(script, buildPortableDeploymentPackage({ appName: "my-console" }).files["deploy.sh"]);
			const result = spawnSync("bash", [script], {
				env: { NODE_ENV: "test", PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`, APP_DIR: appDir, HOME: dir },
				encoding: "utf8",
			});
			let calls: string[][] = [];
			try { calls = readFileSync(log, "utf8").trim().split("\n").map((line) => line.split("\t")); } catch { calls = []; }
			return { status: result.status, stderr: result.stderr, calls, appDir };
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	const databaseUrl = "postgresql://app:pa$$w0rd#1@127.0.0.1:5432/app?schema=public";
	const envFile = ["# production settings", 'APP_NAME="my-console"', `DATABASE_URL="${databaseUrl}"`, "SINGLE='quoted value'", "BARE=plain", ""].join("\n");

	it("stops with a pointer to the env template when the env file is not there yet", () => {
		const result = run(null);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(".env.production");
		expect(result.stderr).toContain("env.production.example");
		expect(result.calls).toEqual([]);
	});

	it("gives Prisma and the build the env file's values, as written", () => {
		// Prisma's config does not read .env.production: "prisma generate" was
		// the second command and stopped on "Cannot resolve environment variable:
		// DATABASE_URL". Read as systemd reads it, a "$" in the password stays.
		for (const content of [envFile, envFile.replaceAll("\n", "\r\n")]) {
			const result = run(content);
			expect(result.stderr).toBe("");
			expect(result.status).toBe(0);
			expect(result.calls.map((call) => call[0])).toEqual(["npm ci", "npx prisma generate", "npx prisma migrate deploy", "npm run build", "npm run build:runtime"]);
			for (const call of result.calls) {
				expect(call[1]).toBe(databaseUrl);
				expect(call[2]).toBe("quoted value");
				expect(call[5]).toBe(result.appDir);
			}
		}
	});

	it("authorizes the production build for this package's own service", () => {
		const build = run(envFile).calls.find((call) => call[0] === "npm run build")!;
		expect(build[3]).toBe("1");
		expect(build[4]).toBe("my-console-next.service");
	});

	it.skipIf(process.platform !== "linux")("passes the build guard on a host where the service is not running, and only then", () => {
		// "npm run build" starts with scripts/guard-live-next-build.mjs. Without
		// the deployment flag it refused every build outside CI, so the script
		// could not get past "npm run build" on the server it was written for.
		const dir = mkdtempSync(path.join(tmpdir(), "vch-export-guard-"));
		try {
			const guard = (systemctl: string, env: Record<string, string>) => {
				writeFileSync(path.join(dir, "systemctl"), `#!/bin/sh\n${systemctl}\n`);
				chmodSync(path.join(dir, "systemctl"), 0o755);
				return spawnSync(process.execPath, [path.resolve("scripts/guard-live-next-build.mjs")], {
					env: { NODE_ENV: "test", PATH: `${dir}:${process.env.PATH ?? "/usr/bin:/bin"}`, ...env },
					encoding: "utf8",
				});
			};
			const deploy = { VCONTROLHUB_DEPLOY_BUILD: "1", NEXT_SYSTEMD_SERVICE: "my-console-next.service" };
			const stopped = 'echo inactive; exit 3';
			expect(guard(stopped, {}).status).toBe(2);
			expect(guard(stopped, deploy).status).toBe(0);
			// A build under a running server would replace the .next it serves.
			const running = guard('[ "$1 $2" = "is-active my-console-next.service" ] && echo active', deploy);
			expect(running.status).toBe(2);
			expect(running.stderr).toContain("my-console-next.service is still active");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
