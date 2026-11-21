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

describe.skipIf(process.platform === "win32")("uninstall path check", () => {
	const run = promisify(execFile);
	it("restricts registered paths to canonical data directories outside protected system trees", async () => {
		const script = await readFile(path.join(process.cwd(), "deploy/uninstall.sh"), "utf8");
		const fn = script.match(/safe_data_path\(\) \{[\s\S]*?\n\}/)![0];
		const check = (candidate: string) => run("bash", ["-c",
			`APP_DIR=/opt/app; normalize_path() { realpath -m -- "$1"; }; ${fn}\nsafe_data_path "$1"`, "bash", candidate]);
		for (const dir of ["/opt/jellyfin/config", "/srv/photos/library", "/var/lib/vcontrolhub"]) {
			await expect(check(dir)).resolves.toBeDefined();
		}
		for (const dir of ["/srv", "/opt/app", "/var/lib/docker/volumes", "/srv/photos/../library", "/etc/postgresql"]) {
			await expect(check(dir)).rejects.toMatchObject({ code: 1 });
		}
	});
});
