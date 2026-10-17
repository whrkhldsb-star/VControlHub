// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const describeLinux = process.platform === "linux" ? describe : describe.skip;

async function ensure(content: string) {
	const root = await mkdtemp(path.join(tmpdir(), "vch-secrets-"));
	roots.push(root);
	const envFile = path.join(root, ".env.runtime");
	await writeFile(envFile, content);
	const script = `set -euo pipefail; source "${path.resolve("deploy/lib/runtime-secrets.sh")}"; ensure_runtime_secrets "${envFile}"`;
	const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
	return { status: result.status, env: await readFile(envFile, "utf8") };
}

// Installs from before STORAGE_DIRECT_ACCESS_SECRET existed could never
// enable target direct connections; deploy.sh now fills the gap.
describeLinux("deploy/lib/runtime-secrets.sh", () => {
	it("adds a missing direct-access secret under set -euo pipefail", async () => {
		const { status, env } = await ensure('DOMAIN="panel.example.com"\n');
		expect(status).toBe(0);
		expect(env).toMatch(/^DOMAIN="panel\.example\.com"\nSTORAGE_DIRECT_ACCESS_SECRET="[0-9a-f]{48}"\n$/);
	});

	it("never replaces an existing secret and adds nothing twice", async () => {
		const existing = 'STORAGE_DIRECT_ACCESS_SECRET="keep-this-value-0123456789abcdef"\n';
		expect((await ensure(existing)).env).toBe(existing);
		const first = await ensure("");
		expect(first.env.match(/STORAGE_DIRECT_ACCESS_SECRET=/g)).toHaveLength(1);
	});

	it("fills an empty value", async () => {
		const { env } = await ensure("STORAGE_DIRECT_ACCESS_SECRET=\n");
		expect(env).toMatch(/\nSTORAGE_DIRECT_ACCESS_SECRET="[0-9a-f]{48}"\n$/);
	});
});
