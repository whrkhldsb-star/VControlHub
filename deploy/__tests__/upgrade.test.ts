// @vitest-environment node
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const describeLinux = process.platform === "linux" ? describe : describe.skip;

/**
 * upgrade.sh is copied next to a stub install.sh that records the DOMAIN it was
 * handed; pull, backup and post-check are skipped so only the env recovery and
 * the hand-off are exercised.
 */
async function runUpgrade(envFile: string, extraEnv: Record<string, string> = {}) {
	const root = await mkdtemp(path.join(tmpdir(), "vch-upgrade-"));
	roots.push(root);
	const deploy = path.join(root, "deploy");
	const app = path.join(root, "app");
	await mkdir(deploy, { recursive: true });
	await mkdir(app, { recursive: true });
	await writeFile(path.join(deploy, "upgrade.sh"), await readFile(path.join(process.cwd(), "deploy/upgrade.sh"), "utf8"), { mode: 0o755 });
	const seen = path.join(root, "seen.txt");
	await writeFile(path.join(deploy, "install.sh"), `#!/bin/bash\nprintf 'DOMAIN=%s\\nCHECK=%s\\n' "\${DOMAIN-unset}" "\${CHECK_PUBLIC_URL-unset}" > "${seen}"\n`, { mode: 0o755 });
	await writeFile(path.join(app, ".env.local"), envFile, { mode: 0o600 });
	const output = await new Promise<{ code: number | null; text: string }>((resolve) => {
		const child = spawn("bash", [path.join(deploy, "upgrade.sh")], {
			// CADDY_FILE points at nothing so the host's own Caddyfile never leaks into the fixture.
			env: { ...process.env, APP_DIR: app, SKIP_PULL: "1", SKIP_PRE_BACKUP: "1", SKIP_POST_CHECK: "1", DOMAIN: "", CHECK_PUBLIC_URL: "", CADDY_FILE: path.join(root, "no-caddyfile"), ...extraEnv },
		});
		let text = "";
		child.stdout.on("data", (chunk) => { text += chunk; });
		child.stderr.on("data", (chunk) => { text += chunk; });
		child.on("close", (code) => resolve({ code, text }));
	});
	return { ...output, seen: await readFile(seen, "utf8").catch(() => "") };
}

describeLinux("deploy/upgrade.sh domain recovery", () => {
	it("recovers the public domain from the first configured origin when DOMAIN was never persisted", async () => {
		const result = await runUpgrade('SSH_WS_ALLOWED_ORIGINS="https://console.example.com,http://127.0.0.1:3000"\n');
		expect(result.code).toBe(0);
		expect(result.seen).toContain("DOMAIN=console.example.com");
		expect(result.seen).toContain("CHECK=https://console.example.com");
	});

	it("recovers the domain from an installer-managed Caddyfile when the env only has loopback origins", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "vch-upgrade-caddy-"));
		roots.push(root);
		const caddyfile = path.join(root, "Caddyfile");
		await writeFile(caddyfile, "# Managed by VControlHub installer: keep\nhttps://panel.example.org {\n\treverse_proxy 127.0.0.1:3000\n}\n");
		const result = await runUpgrade('SSH_WS_ALLOWED_ORIGINS="http://localhost:3000"\n', { CADDY_FILE: caddyfile });
		expect(result.code).toBe(0);
		expect(result.seen).toContain("DOMAIN=panel.example.org");
	});

	it("keeps an IP-only (Apache) installation domainless instead of inventing DOMAIN=localhost", async () => {
		// This is what install.sh writes for an install without DOMAIN: loopback origins only.
		const result = await runUpgrade('DOMAIN=""\nSSH_WS_ALLOWED_ORIGINS="http://localhost:3000,http://127.0.0.1:3000,http://192.0.2.10"\n');
		expect(result.code).toBe(0);
		expect(result.seen).toContain("DOMAIN=\n");
		expect(result.text).not.toContain("Recovered installed domain");
	});

	it("runs git with the checkout declared safe, so a root upgrade of the service user's checkout works", async () => {
		const script = await readFile(path.join(process.cwd(), "deploy/upgrade.sh"), "utf8");
		expect(script).toMatch(/git_app\(\) \{ git -c "safe\.directory=\$\{APP_DIR\}" -C "\$\{APP_DIR\}" "\$@"; \}/);
		expect(script.match(/\bgit -C /g)).toBeNull();
	});

describeLinux("deploy/upgrade.sh pulling a one-click install", () => {
	const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" }).trim();

	/** An origin, an installed clone of it, and a newer commit on the origin. */
	async function installedClone() {
		const root = await mkdtemp(path.join(tmpdir(), "vch-upgrade-pull-"));
		roots.push(root);
		const origin = path.join(root, "origin");
		await mkdir(path.join(origin, "docs"), { recursive: true });
		git(origin, "init", "-q");
		await writeFile(path.join(origin, "docs/route-catalog.json"), '{"generatedAt":"2026-10-21T00:00:00Z"}\n');
		await writeFile(path.join(origin, "README.md"), "v1\n");
		git(origin, "add", "-A");
		git(origin, "commit", "-q", "-m", "v1");
		const app = path.join(root, "app");
		git(root, "clone", "-q", origin, app);
		await writeFile(path.join(origin, "README.md"), "v2\n");
		await writeFile(path.join(origin, "docs/route-catalog.json"), '{"generatedAt":"2026-10-26T00:00:00Z","new":true}\n');
		git(origin, "commit", "-q", "-am", "v2");
		await mkdir(path.join(root, "deploy"));
		await writeFile(path.join(root, "deploy", "upgrade.sh"), await readFile(path.join(process.cwd(), "deploy/upgrade.sh"), "utf8"), { mode: 0o755 });
		await writeFile(path.join(root, "deploy", "install.sh"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
		await writeFile(path.join(app, ".env.local"), 'SSH_WS_ALLOWED_ORIGINS="https://console.example.com"\n', { mode: 0o600 });
		await writeFile(path.join(app, ".git/info/exclude"), ".env.local\n");
		return { root, app, head: git(origin, "rev-parse", "HEAD") };
	}

	async function upgrade(root: string, app: string) {
		return new Promise<{ code: number | null; text: string }>((resolve) => {
			const child = spawn("bash", [path.join(root, "deploy", "upgrade.sh")], {
				env: { ...process.env, APP_DIR: app, UPGRADE_REF: "main", SKIP_PRE_BACKUP: "1", SKIP_POST_CHECK: "1", DOMAIN: "", CHECK_PUBLIC_URL: "", CADDY_FILE: path.join(root, "no-caddyfile") },
			});
			let text = "";
			child.stdout.on("data", (chunk) => { text += chunk; });
			child.stderr.on("data", (chunk) => { text += chunk; });
			child.on("close", (code) => resolve({ code, text }));
		});
	}

	it("updates a checkout whose route catalog the installer's build rewrote", async () => {
		// The build regenerates docs/route-catalog.json; every update of a
		// one-click install stopped at "Working tree has local changes".
		const { root, app, head } = await installedClone();
		await writeFile(path.join(app, "docs/route-catalog.json"), '{"generatedAt":"2026-10-26T09:15:12Z"}\n');
		const result = await upgrade(root, app);
		expect(result.text).not.toContain("Working tree has local changes");
		expect(result.code).toBe(0);
		expect(git(app, "rev-parse", "HEAD")).toBe(head);
	});

	it("still refuses to update over a change someone made", async () => {
		const { root, app } = await installedClone();
		await writeFile(path.join(app, "README.md"), "edited on the server\n");
		const result = await upgrade(root, app);
		expect(result.code).not.toBe(0);
		expect(result.text).toContain("Working tree has local changes");
	});
});
});
