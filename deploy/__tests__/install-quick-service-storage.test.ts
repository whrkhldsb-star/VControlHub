// @vitest-environment node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), "vch-qs-"));
	roots.push(root);
	const bin = path.join(root, "bin");
	const app = path.join(root, "srv", "vch");
	await mkdir(bin);
	await mkdir(path.join(app, "deploy/systemd"), { recursive: true });
	await writeFile(path.join(app, "deploy/install.sh"), "");
	await writeFile(path.join(app, "deploy/systemd/vcontrolhub-next.service.example"), "");
	await writeFile(path.join(app, ".env.local"), 'DATABASE_URL="postgres://app@db.example/app"\n');
	const key = createHash("sha256").update("vch\0" + app).digest("hex");
	const state = path.join(root, "etc/vcontrolhub/instances", key);
	for (const [cmd, body] of Object.entries({
		id: '[[ $1 == -u ]] && echo 0',
		systemctl: "exit 0",
		chown: 'echo "chown $*" >> "$CALLS"',
		sudo: 'echo "unexpected sudo" >> "$CALLS"; exit 1',
		docker: [
			'echo "docker $*" >> "$CALLS"',
			'case "$1" in',
			'  info|volume|network) exit 0 ;;',
			'  ps) if [[ "$*" != *"--filter label=com.vcontrolhub.instance=$(cat "$INSTANCE_ID_FILE")" ]]; then',
			'        printf "%s\\n" qs-third-party other-instance;',
			'      elif [[ ! -f $REMOVED ]]; then echo owned-container; fi ;;',
			'  rm) [[ $* == "rm -f owned-container" ]] && touch "$REMOVED" ;;',
			'esac',
		].join("\n"),
	})) await writeFile(path.join(bin, cmd), "#!/bin/bash\n" + body + "\n", { mode: 0o755 });
	const env = {
		NODE_ENV: process.env.NODE_ENV,
		PATH: bin + ":" + process.env.PATH, APP_DIR: app, APP_SLUG: "vch", APP_USER: "vch",
		DESTDIR: root, SKIP_DOCKER: "0", CALLS: path.join(root, "calls"),
		INSTANCE_ID_FILE: path.join(state, "docker-instance"), REMOVED: path.join(root, "container-removed"),
	};
	// Map absolute host paths into the fixture while running the uninstall entrypoint.
	const source = await readFile("deploy/uninstall.sh", "utf8");
	const uninstall = path.join(root, "uninstall.sh");
	await writeFile(uninstall, source.replaceAll("/etc/", root + "/etc/").replaceAll("/srv/", root + "/srv/"));
	return { root, app, state, env, uninstall: (...args: string[]) => run("bash", [uninstall, ...args], { env }) };
}

describe.skipIf(process.platform !== "linux")("installer ownership and uninstall", () => {
	it("keeps pre-existing and replaced directories across reinstall, and removes the recorded, unchanged directory", async () => {
		const f = await fixture();
		const serviceDir = path.join(f.root, "srv", "services");
		const existing = path.join(serviceDir, "minio");
		const fresh = path.join(serviceDir, "jellyfin");
		const replaced = path.join(serviceDir, "replaced");
		const redirected = path.join(serviceDir, "redirected");
		const nestedParent = path.join(serviceDir, "custom-storage");
		const nestedBackup = path.join(nestedParent, "backups");
		await mkdir(existing, { recursive: true });
		await writeFile(path.join(existing, "keep"), "shared");
		const source = await readFile("deploy/install.sh", "utf8");
		const functions = ["init_instance_state", "record_created_data_dir", "create_data_dir", "prepare_quick_service_storage"].map(name =>
			source.match(new RegExp(name + "\\(\\) \\{[\\s\\S]*?\\n\\}"))![0]);
		await run("bash", ["-c", [
			"set -eu", ...functions, "init_instance_state", 'DESTDIR=""', "log() { :; }",
			'quick_service_host_paths() { printf "%s\\n" "$EXISTING" "$FRESH" "$REPLACED" "$REDIRECTED"; }',
			"prepare_quick_service_storage", "prepare_quick_service_storage",
			'create_data_dir "$NESTED_ROOT"', 'create_data_dir "$NESTED_ROOT/backups"',
		].join("\n")], { env: { ...f.env, EXISTING: existing, FRESH: fresh, REPLACED: replaced, REDIRECTED: redirected, NESTED_ROOT: nestedParent } });
		const manifest = await readFile(path.join(f.state, "directories"), "utf8");
		expect(manifest.trim().split("\n").filter(line => line.startsWith("tree\t"))).toHaveLength(5);
		expect(manifest).toContain("retain\t-\t" + existing + "\n");
		expect((await readFile(f.env.CALLS, "utf8")).trim().split("\n")).toEqual(
			[fresh, replaced, redirected, nestedParent, nestedBackup].map(dir => "chown vch:vch " + dir));
		await writeFile(path.join(fresh, "owned"), "service data");
		await rename(replaced, replaced + "-old");
		await mkdir(replaced);
		await rename(nestedBackup, nestedBackup + "-old");
		await mkdir(nestedBackup);
		await writeFile(path.join(nestedBackup, "keep"), "replacement backup");
		await writeFile(path.join(replaced, "keep"), "replacement");
		await rename(redirected, redirected + "-old");
		await symlink(existing, redirected);
		expect((await readFile(f.env.INSTANCE_ID_FILE, "utf8")).trim()).toMatch(/^[0-9a-f]{32}$/);
		const dry = await f.uninstall("--dry-run");
		expect(dry.stdout).toContain(fresh);
		expect(dry.stdout).not.toContain(existing);
		expect(dry.stderr).toContain(replaced);
		expect(existsSync(fresh)).toBe(true);
		await f.uninstall("--yes", "--force-paths");
		expect(existsSync(fresh)).toBe(false);
		expect(existsSync(f.state)).toBe(false);
		expect(await readFile(path.join(nestedBackup, "keep"), "utf8")).toBe("replacement backup");
		expect(existsSync(f.app)).toBe(false);
		expect(await readFile(path.join(redirected, "keep"), "utf8")).toBe("shared");
		expect(await readFile(path.join(replaced, "keep"), "utf8")).toBe("replacement");
		const calls = await readFile(f.env.CALLS, "utf8");
		expect(calls).toContain("docker rm -f owned-container");
		expect(calls).not.toContain("unexpected sudo");
		expect(calls).not.toContain("qs-third-party");
		expect(calls).not.toContain("other-instance");
	});

	it("preserves unregistered data even when a legacy environment names it", async () => {
		const f = await fixture();
		const external = path.join(f.root, "srv/vch-data/storage");
		await mkdir(external, { recursive: true });
		await writeFile(path.join(external, "keep"), "legacy");
		await writeFile(path.join(f.app, ".env.local"), 'STORAGE_ROOT="' + external + '"\n');
		const result = await f.uninstall("--yes");
		expect(result.stderr).toContain("No installer data directory inventory");
		expect(result.stderr).toContain("No verified Docker instance label");
		expect(existsSync(f.env.REMOVED)).toBe(false);
		expect(await readFile(path.join(external, "keep"), "utf8")).toBe("legacy");
		expect(existsSync(f.app)).toBe(false);
	});

	it("removes legacy application code and configuration while retaining local uploads, backups and custom data", async () => {
		const f = await fixture();
		const saved = ["uploads/customer.jpg", "backups/db.dump", "photos/original.jpg", "public/legacy/object"];
		for (const file of [...saved, "src/service.ts", ".next/BUILD_ID", "dist/server.js"]) {
			await mkdir(path.dirname(path.join(f.app, file)), { recursive: true });
			await writeFile(path.join(f.app, file), file);
		}
		await writeFile(path.join(f.app, ".env.runtime"), 'STORAGE_ROOT="${APP_DIR}/public/legacy"\n');
		const result = await f.uninstall("--yes");
		for (const file of saved) expect(await readFile(path.join(f.app, file), "utf8")).toBe(file);
		for (const file of ["src", "deploy", ".next", "dist", ".env.local", ".env.runtime"]) {
			expect(existsSync(path.join(f.app, file)), file).toBe(false);
		}
		expect(result.stderr).toContain("Review retained files");
	});
});
