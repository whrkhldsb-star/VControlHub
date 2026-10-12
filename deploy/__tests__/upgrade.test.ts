// @vitest-environment node
import { spawn } from "node:child_process";
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
});
