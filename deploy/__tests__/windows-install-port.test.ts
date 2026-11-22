// @vitest-environment node
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Windows installer loads the env file into its own process before it
 * starts the tasks, and the web task listens on PORT (src/server.ts). Its
 * health check polled a fixed 127.0.0.1:3000, so a custom port failed the
 * install while the service ran fine.
 */
describe("Windows installer health check", () => {
	it("polls the configured port instead of a fixed 3000", async () => {
		const script = await readFile(path.join(process.cwd(), "deploy/windows/publish-release.ps1"), "utf8");
		const healthCheck = script.slice(script.indexOf("$ready = $false"));
		expect(script).toMatch(/\$webPort = if \(\$env:PORT\)/);
		expect(healthCheck).toContain("-Uri $healthUrl");
		expect(healthCheck).not.toMatch(/127\.0\.0\.1:3000/);
	});
});

it("rejects conflicting administrator settings by key and pins runtime values to the release file", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "vch-windows-env-"));
	try {
		const file = path.join(root, ".env.local");
		const reader = path.resolve("deploy/windows/read-install-env.mjs");
		await writeFile(file, "DATABASE_URL=postgresql://file-user@localhost/file-db\nPORT=4891\n");
		for (const conflict of ["DATABASE_URL", "PORT"]) {
			const parent = { ...process.env, DATABASE_URL: "postgresql://file-user@localhost/file-db", PORT: "4891", [conflict]: "parent-value" };
			const result = spawnSync(process.execPath, [reader, file], { env: parent, encoding: "utf8" });
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("configuration: " + conflict);
			expect(result.stderr).not.toMatch(/parent-value|file-user/);
			const runtime = spawnSync(process.execPath, [reader, file, "--runtime"], { env: parent, encoding: "utf8" });
			expect(JSON.parse(runtime.stdout)).toMatchObject({ DATABASE_URL: "postgresql://file-user@localhost/file-db", PORT: "4891" });
		}
	} finally { await rm(root, { recursive: true, force: true }); }
});
