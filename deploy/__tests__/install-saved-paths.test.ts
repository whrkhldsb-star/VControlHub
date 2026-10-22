// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

/**
 * Re-running the installer from a fresh shell (no STORAGE_ROOT, BACKUP_DIR
 * or ARIA2_RPC_DIR exported) rewrote those paths in .env.local to the
 * standard ones, moving a custom install's data directories without a word.
 */
describe.skipIf(process.platform === "win32")("installer keeps saved data directories", () => {
	it("reads the saved value, ignoring template syntax", async () => {
		const script = await readFile(path.join(process.cwd(), "deploy/install.sh"), "utf8");
		const helper = script.slice(script.indexOf("env_file_value() {"), script.indexOf("\n}\n", script.indexOf("env_file_value() {")) + 3);
		const dir = await mkdtemp(path.join(os.tmpdir(), "vch-install-env-"));
		try {
			const envFile = path.join(dir, ".env.local");
			await writeFile(envFile, 'STORAGE_ROOT="/srv/owned-store"\nBACKUP_DIR=\'/srv/owned-backups\'\nARIA2_RPC_DIR="/var/lib/${APP_SLUG:-vcontrolhub}/aria2"\n');
			const read = async (name: string) => (await run("bash", ["-c", `${helper}\nENV_FILE=${JSON.stringify(envFile)}\nenv_file_value ${name}`])).stdout;
			expect(await read("STORAGE_ROOT")).toBe("/srv/owned-store");
			expect(await read("BACKUP_DIR")).toBe("/srv/owned-backups");
			expect(await read("ARIA2_RPC_DIR")).toBe("");
			expect(await read("MISSING")).toBe("");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
		expect(script).toContain('local effective_storage_root="${STORAGE_ROOT_OVERRIDE:-${saved_storage_root:-/var/lib/${APP_SLUG}/storage}}"');
		expect(script).toContain('local effective_backup_dir="${BACKUP_DIR_OVERRIDE:-${saved_backup_dir:-/var/backups/${APP_SLUG}}}"');
		expect(script).toContain('local effective_aria2_rpc_dir="${ARIA2_RPC_DIR_OVERRIDE:-${saved_aria2_rpc_dir:-/var/lib/${APP_SLUG}/aria2}}"');
	});
});
