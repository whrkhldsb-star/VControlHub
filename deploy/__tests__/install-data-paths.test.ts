// @vitest-environment node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const read = (file: string) => readFile(path.join(process.cwd(), file), "utf8");

async function installerFunction(name: string) {
	const script = await read("deploy/install.sh");
	const start = script.indexOf(`${name}() {`);
	expect(start, `${name} is defined in deploy/install.sh`).toBeGreaterThan(-1);
	return script.slice(start, script.indexOf("\n}\n", start) + 3);
}

/**
 * The installer takes STORAGE_ROOT, BACKUP_DIR, ARIA2_RPC_DIR and FILE_VERSION_DIR, creates the directories and
 * keeps the choice across runs. The units run with ProtectSystem=strict and listed only the standard locations,
 * so the services could not write to a custom directory; and with a custom BACKUP_DIR the standard
 * /var/backups/<slug>, listed without "-", was never created, which keeps a unit from starting (226/NAMESPACE).
 */
describe.skipIf(process.platform === "win32")("installer data directories and the unit sandbox", () => {
	it("lists the custom data directories as optional writable paths, once each", async () => {
		const helper = await installerFunction("custom_data_read_write_paths");
		const list = async (...paths: string[]) => (await run("bash", ["-c", `${helper}\nAPP_SLUG=vcontrolhub\nAPP_DIR=/opt/VControlHub\ncustom_data_read_write_paths "$@"`, "bash", ...paths])).stdout;
		expect(await list("/data/store", "/mnt/backups/", "/data/aria2", "/data/store/file-versions")).toBe("-/data/store -/mnt/backups -/data/aria2 -/data/store/file-versions");
		// Already writable through the template, relative, empty, repeated, or not expressible in the list.
		expect(await list("/var/lib/vcontrolhub/storage", "/var/backups/vcontrolhub", "/opt/VControlHub/storage", "relative/dir", "", "/data/a", "/data/a", "/data/with space")).toBe("-/data/a");
	});

	it("renders them into the units that write there", async () => {
		const install = await read("deploy/install.sh");
		// The upload staging directory and the thumbnail cache are not the installer's to choose, but a
		// location named in the environment file has to be writable for the web process and the worker alike.
		expect(install).toContain('custom_data_read_write_paths "${STORAGE_ROOT:-}" "${BACKUP_DIR:-}" "${ARIA2_RPC_DIR:-}" "${FILE_VERSION_DIR:-}" "$(env_file_value MEDIA_UPLOAD_TMP_DIR)" "$(env_file_value MEDIA_THUMB_CACHE_DIR)"');
		expect(install).toContain('custom_data_read_write_paths "${ARIA2_RPC_DIR:-}"');
		for (const unit of ["next", "worker"]) {
			const template = await read(`deploy/systemd/vcontrolhub-${unit}.service.example`);
			const line = template.match(/^ReadWritePaths=.*$/m)?.[0] ?? "";
			// Not created when BACKUP_DIR points elsewhere: optional.
			expect(line).toContain(" -/var/backups/{{APP_SLUG}} ");
			expect(line.endsWith("{{QUICK_SERVICE_READ_WRITE_PATHS}}")).toBe(true);
		}
		const aria2 = await read("deploy/systemd/vcontrolhub-aria2.service.example");
		expect(aria2).toMatch(/^ReadWritePaths=-\/var\/lib\/\{\{APP_SLUG\}\} -\{\{APP_DIR\}\}\/tmp\{\{ARIA2_DATA_READ_WRITE_PATHS\}\}$/m);
		// Every renderer of the aria2 template fills the placeholder.
		expect(await read("deploy.sh")).toContain("{{ARIA2_DATA_READ_WRITE_PATHS}}");
		expect(await read("deploy/verify-assets.sh")).toContain("{{ARIA2_DATA_READ_WRITE_PATHS}}");
	});

	it("marks the quick-service directories optional", async () => {
		// The installer creates some fifty directories under /opt for services that may never be installed. One
		// removed by hand would otherwise keep the application from starting at the next restart.
		const install = await read("deploy/install.sh");
		expect(install).toContain(`quick_service_host_paths | sed 's|^|-|'`);
	});
});
