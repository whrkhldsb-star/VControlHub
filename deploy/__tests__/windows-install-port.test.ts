// @vitest-environment node
import { readFile } from "node:fs/promises";
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
		const script = await readFile(path.join(process.cwd(), "deploy/windows/install.ps1"), "utf8");
		const healthCheck = script.slice(script.indexOf("$ready = $false"));
		expect(script).toMatch(/\$webPort = if \(\$env:PORT\)/);
		expect(healthCheck).toContain("-Uri $healthUrl");
		expect(healthCheck).not.toMatch(/127\.0\.0\.1:3000/);
	});
});
