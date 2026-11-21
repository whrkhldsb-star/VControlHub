// @vitest-environment node
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

describe.skipIf(process.platform !== "linux")("installer destination ownership", () => {
	it.each(["clone", "archive", "wrong origin", "nested checkout"])("refuses a nonempty %s destination before host setup", async mode => {
		const root = await mkdtemp(path.join(os.tmpdir(), "vch-install-target-"));
		const app = path.join(root, "app");
		const requestedRemote = path.join(root, "unreachable-origin");
		try {
			await mkdir(app);
			await writeFile(path.join(app, ".local-backup"), "retained");
			if (mode === "wrong origin" || mode === "nested checkout") {
				const repo = mode === "wrong origin" ? app : root;
				await run("git", ["-C", repo, "init", "-q"]);
				await run("git", ["-C", repo, "remote", "add", "origin", mode === "wrong origin" ? "unrelated" : requestedRemote]);
				if (mode === "wrong origin") {
					// A second, matching URL does not change where git actually fetches.
					await run("git", ["-C", repo, "config", "--add", "remote.origin.url", requestedRemote]);
				}
			}
			await expect(run("bash", ["deploy/install.sh"], {
				env: {
					...process.env, APP_DIR: app, SOURCE_DIR: process.cwd(), REPO_URL: mode === "archive" ? "" : requestedRemote,
					DESTDIR: path.join(root, "fakeroot"), INSTALL_SYSTEMD_UNITS: "1", SKIP_RESTART: "1", SKIP_PACKAGES: "1",
				},
			})).rejects.toMatchObject({
				stderr: expect.stringContaining("Refusing nonempty APP_DIR"),
				stdout: expect.not.stringContaining("Syncing application"),
			});
			expect(await readFile(path.join(app, ".local-backup"), "utf8")).toBe("retained");
			expect(existsSync(path.join(root, "fakeroot"))).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("clones into an empty directory and updates the matching checkout", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "vch-install-clone-"));
		const origin = path.join(root, "origin");
		const app = path.join(root, "app");
		const git = (...args: string[]) => run("git", ["-C", origin, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
		try {
			await mkdir(origin);
			await mkdir(app);
			await git("init", "-q");
			await writeFile(path.join(origin, "version"), "one");
			await mkdir(path.join(origin, "uploads"));
			await writeFile(path.join(origin, "uploads/.gitkeep"), "");
			await git("add", "version", "uploads/.gitkeep");
			await git("commit", "-qm", "one");
			const installer = await readFile("deploy/install.sh", "utf8");
			const directoryFunctions = installer.slice(installer.indexOf("record_created_data_dir()"), installer.indexOf("prepare_quick_service_storage()"));
			const sync = installer.slice(installer.indexOf("is_app_source_tree()"), installer.indexOf("write_env_if_missing()"));
			const runSync = () => run("bash", ["-c", [
				"set -euo pipefail", "log() { :; }", "warn() { :; }", "fail() { echo \"$*\" >&2; exit 1; }",
				"chown() { :; }", directoryFunctions, sync, "sync_source",
			].join("\n")], { env: { ...process.env, APP_USER: "app", INSTANCE_STATE_DIR: root, APP_DIR: app, REPO_URL: origin, SOURCE_DIR: process.cwd() } });
			await runSync();
			expect(await readFile(path.join(app, "version"), "utf8")).toBe("one");
			const inventory = await readFile(path.join(root, "directories"), "utf8");
			expect(inventory.split("\n").filter(row => row.startsWith("tree\t")).map(row => row.split("\t")[2])).toContain(path.join(app, "uploads"));
			await writeFile(path.join(app, ".env.local"), "retained");
			await writeFile(path.join(origin, "version"), "two");
			await git("commit", "-qam", "two");
			await runSync();
			expect(await readFile(path.join(app, "version"), "utf8")).toBe("two");
			expect(await readFile(path.join(app, ".env.local"), "utf8")).toBe("retained");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

function hasRsync() {
	try {
		execFileSync("rsync", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/** The --exclude patterns of the installer's rsync command, as written in the script. */
async function installerRsyncExcludes() {
	const script = await readFile(path.join(process.cwd(), "deploy/install.sh"), "utf8");
	const start = script.indexOf("rsync -a --delete");
	const end = script.indexOf('"${SOURCE_DIR}/" "${APP_DIR}/"', start);
	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);
	return [...script.slice(start, end).matchAll(/--exclude\s+('[^']*'|\S+)/g)].map((match) => match[1]!.replace(/^'|'$/g, ""));
}

/**
 * Installing from a release archive or another checkout copies the source into APP_DIR with rsync. A pattern
 * without a leading slash matches a directory of that name at any depth: "downloads", "backups" and "logs", meant
 * for the runtime data at the top of the install, also left out src/lib/downloads, the downloads and backups pages
 * with their routes, and the AI operations log route. A fresh install then failed to build; an upgrade kept the
 * old copies of those directories beside the new code. The other tests replace rsync with a stub.
 */
describe.skipIf(process.platform === "win32" || !hasRsync())("installer source sync", () => {
	it("copies source directories that share a name with runtime data, and leaves runtime data alone", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "vch-install-sync-"));
		const source = path.join(root, "source");
		const target = path.join(root, "app");
		const put = async (base: string, file: string, content = "x") => {
			await mkdir(path.dirname(path.join(base, file)), { recursive: true });
			await writeFile(path.join(base, file), content);
		};
		try {
			const sourceFiles = [
				"src/lib/downloads/service.ts",
				"src/app/downloads/page.tsx",
				"src/app/api/downloads/route.ts",
				"src/app/backups/page.tsx",
				"src/app/api/backups/route.ts",
				"src/app/api/ai/ops/logs/route.ts",
				"src/lib/storage/service.ts",
				"src/app/uploads/page.tsx",
				"src/lib/tmp/helper.ts",
				"src/lib/distance.ts",
				"package.json",
			];
			for (const file of sourceFiles) await put(source, file, "new");
			// What a working checkout carries and an install must not take.
			const sourceOnly = [
				".git/config", "node_modules/pkg/index.js", ".next/BUILD_ID", "dist/server.js", ".env.local", ".env.runtime",
				"storage/file.bin", "backups/dump.sql", "downloads/movie.mkv", "uploads/a.png", "logs/app.log", "tmp/work", "coverage/index.html",
			];
			for (const file of sourceOnly) await put(source, file, "from-source");
			// What the install already holds: its own runtime data, and a source file the new version dropped.
			const runtime = [".env.local", ".env.runtime", "storage/kept.bin", "backups/kept.sql", "downloads/kept.mkv", "uploads/kept.png", "logs/kept.log", "tmp/kept"];
			for (const file of runtime) await put(target, file, "kept");
			await put(target, "src/lib/downloads/removed-in-this-version.ts", "old");

			const excludes = (await installerRsyncExcludes()).flatMap((pattern) => ["--exclude", pattern]);
			await run("rsync", ["-a", "--delete", ...excludes, `${source}/`, `${target}/`]);

			for (const file of sourceFiles) expect(existsSync(path.join(target, file)), file).toBe(true);
			for (const file of sourceOnly) expect(existsSync(path.join(target, file)) && (await readFile(path.join(target, file), "utf8")) === "from-source", file).toBe(false);
			for (const file of runtime) expect(await readFile(path.join(target, file), "utf8"), file).toBe("kept");
			expect(existsSync(path.join(target, "src/lib/downloads/removed-in-this-version.ts"))).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
