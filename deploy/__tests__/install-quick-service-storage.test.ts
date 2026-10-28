// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const describeLinux = process.platform === "linux" ? describe : describe.skip;

describeLinux("deploy/install.sh Quick Service directories", () => {
	it("creates and owns only the directories it makes, and leaves existing data alone", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "vch-qs-"));
		roots.push(root);
		const existing = path.join(root, "srv");
		const fresh = path.join(root, "opt", "jellyfin", "config");
		await mkdir(existing);
		const log = path.join(root, "chown.log");
		const source = await readFile("deploy/install.sh", "utf8");
		const fn = /prepare_quick_service_storage\(\) \{[\s\S]*?\n\}\n/.exec(source)?.[0];
		if (!fn) throw new Error("prepare_quick_service_storage not found");
		const script = [
			"set -euo pipefail",
			`DESTDIR=""; SKIP_DOCKER=0; APP_USER=appuser`,
			"log() { :; }",
			`quick_service_host_paths() { printf '%s\\n' '${existing}' '${fresh}'; }`,
			`chown() { echo "chown $*" >> '${log}'; }`,
			fn,
			"prepare_quick_service_storage",
		].join("\n");
		const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
		expect(result.status).toBe(0);
		// Not recursive, and not for the directory that was already there (whole of /srv, media libraries ...).
		expect((await readFile(log, "utf8")).trim().split("\n")).toEqual([`chown appuser:appuser ${fresh}`]);
	});
});
