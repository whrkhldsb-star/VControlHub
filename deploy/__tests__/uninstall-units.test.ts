// @vitest-environment node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

/**
 * A complete uninstall stops, disables and deletes every systemd unit the
 * installer writes. The aria2 relay unit was left out, so it kept running
 * (Restart=always) after the application, its data and its user were gone.
 */
describe("uninstall service list", () => {
	it("covers every unit install.sh renders", async () => {
		const [install, uninstall] = await Promise.all([
			readFile(path.join(process.cwd(), "deploy/install.sh"), "utf8"),
			readFile(path.join(process.cwd(), "deploy/uninstall.sh"), "utf8"),
		]);
		const rendered = install.match(/for svc in ([a-z0-9 -]+); do/)![1]!.trim().split(/\s+/);
		expect(rendered).toContain("aria2");
		const units = uninstall.slice(uninstall.indexOf("units=("), uninstall.indexOf(")", uninstall.indexOf("units=(")));
		for (const svc of rendered) expect(units).toContain(`"\${SERVICE_PREFIX}-${svc}.service"`);
		// The nightly backup timer and its service are rendered by a loop of their own. Left behind, the timer went
		// on firing every night against a deleted directory, and the final check reported a verified uninstall.
		expect(install).toContain("for backup_kind in service timer; do");
		for (const kind of ["timer", "service"]) expect(units).toContain(`"\${SERVICE_PREFIX}-backup.${kind}"`);
	});
});

/**
 * The path check asks that a directory named in the environment file contains the application slug, so that a typo
 * there cannot remove another application's data. It was also applied to the installer's own list of Quick Service
 * directories (/opt/adguardhome/conf, ...), none of which contains the slug: every complete uninstall stopped at
 * the first of them, after the services, the database and the data directories were gone and before the
 * application directory, its secrets and its user were removed. Nothing is deleted here: only the check runs.
 */
describe.skipIf(process.platform === "win32")("uninstall path check", () => {
	const run = promisify(execFile);
	async function check(pathToCheck: string, ...extra: string[]) {
		const uninstall = await readFile(path.join(process.cwd(), "deploy/uninstall.sh"), "utf8");
		const start = uninstall.indexOf("safe_data_path() {");
		const fn = uninstall.slice(start, uninstall.indexOf("\n}\n", start) + 3);
		const script = `set -euo pipefail\nAPP_SLUG=vcontrolhub\nFORCE_PATHS=0\nfail() { echo "$*" >&2; exit 1; }\nnormalize_path() { realpath -m -- "$1"; }\n${fn}\nsafe_data_path "$@"`;
		return run("bash", ["-c", script, "bash", pathToCheck, ...extra]).then((result) => ({ ok: true, out: result.stdout }), (error: { stderr: string }) => ({ ok: false, out: error.stderr }));
	}

	it("accepts the installer's own Quick Service directories and still questions a path from the environment file", async () => {
		expect(await check("/opt/adguardhome/conf", "inventory")).toEqual({ ok: true, out: "/opt/adguardhome/conf" });
		expect(await check("/srv/photos/library", "inventory")).toEqual({ ok: true, out: "/srv/photos/library" });
		// From the environment file: the slug is still required.
		const fromEnv = await check("/opt/other-app/data");
		expect(fromEnv.ok).toBe(false);
		expect(fromEnv.out).toContain("does not contain the APP_SLUG");
		expect(await check("/var/lib/vcontrolhub/storage")).toEqual({ ok: true, out: "/var/lib/vcontrolhub/storage" });
		// The inventory does not open system directories.
		expect((await check("/var/lib/docker/volumes", "inventory")).ok).toBe(false);
		expect((await check("/etc/passwd", "inventory")).ok).toBe(false);
	});

	it("passes the inventory marker for the Quick Service list only", async () => {
		const uninstall = await readFile(path.join(process.cwd(), "deploy/uninstall.sh"), "utf8");
		expect(uninstall.match(/safe_data_path "\$\{data_path\}" inventory/g)?.length).toBe(1);
	});
});
