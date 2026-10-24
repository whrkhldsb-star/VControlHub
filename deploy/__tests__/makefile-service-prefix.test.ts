// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);

/**
 * make restart / status / logs in /opt/VControlHub used "VControlHub" as the
 * service prefix, while the installer names the services after the lowercase
 * APP_SLUG (vcontrolhub-next, …): they restarted and read the wrong units.
 */
describe.skipIf(process.platform === "win32")("Makefile service prefix", () => {
	let dir: string;
	const units = async (appDir: string, extra: string[] = []) => {
		const { stdout } = await run("make", ["-s", "-n", "-f", path.join(process.cwd(), "Makefile"), "status", `APP_DIR=${appDir}`, ...extra]);
		return stdout.match(/[\w-]+-next\.service/)?.[0];
	};
	beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "vch-make-")); });
	afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

	it("uses the installer's lowercase name, not the directory's spelling", async () => {
		const app = path.join(dir, "VControlHub");
		await mkdir(app);
		expect(await units(app)).toBe("vcontrolhub-next.service");
	});

	it("follows the APP_SLUG the install recorded, and an explicit prefix", async () => {
		const app = path.join(dir, "VControlHub");
		await mkdir(app);
		await writeFile(path.join(app, ".env.local"), 'APP_SLUG="custom-hub"\n');
		expect(await units(app)).toBe("custom-hub-next.service");
		expect(await units(app, ["SERVICE_PREFIX=explicit"])).toBe("explicit-next.service");
	});
});
