// @vitest-environment node
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAutomaticMigration } from "../check-upgrade-migrations.mjs";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const describeLinux = process.platform === "linux" ? describe : describe.skip;

// All process, build and HTTP operations below are fixtures. Git and the
// filesystem are real so a rollback must actually restore the old release.
async function fixtureCommands(root: string) {
	const bin = path.join(root, "bin");
	await mkdir(bin);
	const commands = {
		npm: `echo "npm $* $PWD" >> "$LOG"
if [[ "$*" == 'run prisma:generate' && -n "$EXPECT_TOOL_ENV" ]]; then
  test "$TOOL_ENV" = "$EXPECT_TOOL_ENV" || exit 23
fi
if [[ "$*" == 'run build' && -n "$OBSERVE_ENV" ]]; then
  test ! -e .env.preview && test ! -e .env.custom || exit 24
  test "$(stat -c %a .env.production.local)" = 600 || exit 25
  NODE_ENV=production node -e 'require(process.env.NEXT_ENV_PACKAGE).loadEnvConfig(process.cwd()); process.stdout.write(process.env.NEXT_PUBLIC_APP_TIME_ZONE)' > "$OBSERVE_ENV" || exit 26
fi
if [[ "$*" == 'run build' && -n "$STATE_DIR" ]]; then
  test ! -e "$STATE_DIR" || exit 27
  echo late-write >> "$APP_DIR/$STATE_DIR/data"
fi
if [[ "$*" == 'run build:runtime' ]]; then
  mkdir -p .next dist node_modules scripts
  for f in .next/BUILD_ID dist/server.js dist/worker.js dist/ssh-ws-proxy.js; do echo candidate > "$f"; done
  echo '{}' > package.json
fi
[[ "$FAIL" != build || "$*" != 'run build' ]]`,
		systemctl: `echo "systemctl $*" >> "$LOG"
case "$1:$4" in
  show:LoadState) echo loaded ;;
  show:ActiveState) case "$2" in *-next.service|*-ssh-ws.service) echo active;; *) echo inactive;; esac ;;
  start:*) if [[ "$FAIL" == start && -f "$APP_DIR/dist/server.js" ]] && [ "$(cat "$APP_DIR/dist/server.js")" = candidate ]; then exit 1; fi ;;
esac`,
		curl: "exit 0",
		chown: "exit 0",
	};
	for (const [name, content] of Object.entries(commands)) {
		await writeFile(path.join(bin, name), "#!/bin/bash\n" + content + "\n", { mode: 0o755 });
	}
	return { NEXT_ENV_PACKAGE: fileURLToPath(import.meta.resolve("@next/env")), PATH: bin + ":" + process.env.PATH, LOG: path.join(root, "calls"), DEPLOY_LOCK: path.join(root, "deploy.lock"),
		SKIP_PRE_BACKUP: "1", SKIP_DB_SETUP: "1", DOMAIN: "", CHECK_PUBLIC_URL: "", CADDY_FILE: path.join(root, "no-caddyfile"), FAIL: "" };
}

async function invoke(app: string, env: Record<string, string>, driver = path.resolve("deploy/upgrade.sh")) {
	return new Promise<{ code: number | null; text: string }>((resolve) => {
		const child = spawn("bash", [driver], {
			env: { ...process.env, APP_DIR: app, ...env },
		});
		let text = "";
		child.stdout.on("data", chunk => { text += chunk; });
		child.stderr.on("data", chunk => { text += chunk; });
		child.on("close", code => resolve({ code, text }));
	});
}

async function runUpgrade(envFile: string, extraEnv: Record<string, string> = {}) {
	const root = await mkdtemp(path.join(tmpdir(), "vch-upgrade-"));
	roots.push(root);
	const app = path.join(root, "app");
	await mkdir(path.join(app, "deploy"), { recursive: true });
	await mkdir(path.join(app, "dist"));
	await mkdir(path.join(app, "storage"));
	await writeFile(path.join(app, "storage", "customer-file"), "retained");
	await writeFile(path.join(app, "dist/server.js"), "old");
	await writeFile(path.join(app, "deploy/check.sh"), '#!/bin/bash\nprintf "DOMAIN=%s\\nCHECK=%s\\n" "$DOMAIN" "$CHECK_PUBLIC_URL" > "$SEEN"\n[[ "$FAIL" != health ]]\n', { mode: 0o755 });
	await writeFile(path.join(app, ".env.local"), envFile, { mode: 0o600 });
	const env = await fixtureCommands(root);
	const seen = path.join(root, "seen");
	const result = await invoke(app, { ...env, SKIP_PULL: "1", SEEN: seen, ...extraEnv });
	return { ...result, app, log: await readFile(env.LOG, "utf8"), seen: await readFile(seen, "utf8").catch(() => "") };
}

describeLinux("deploy/upgrade.sh domain recovery", () => {
	it("recovers the public domain from the first configured origin when DOMAIN was never persisted", async () => {
		const result = await runUpgrade('SSH_WS_ALLOWED_ORIGINS="https://console.example.com,http://127.0.0.1:3000"\n');
		expect(result.code).toBe(0);
		expect(result.seen).toContain("DOMAIN=console.example.com");
		expect(result.seen).toContain("CHECK=https://console.example.com");
	});

	it("recovers the domain from an installer-managed Caddyfile when the env only has loopback origins", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "vch-upgrade-caddy-"));
		roots.push(root);
		const caddyfile = path.join(root, "Caddyfile");
		await writeFile(caddyfile, "# Managed by VControlHub installer: keep\nhttps://panel.example.org {\n\treverse_proxy 127.0.0.1:3000\n}\n");
		const result = await runUpgrade('SSH_WS_ALLOWED_ORIGINS="http://localhost:3000"\n', { CADDY_FILE: caddyfile });
		expect(result.code).toBe(0);
		expect(result.seen).toContain("DOMAIN=panel.example.org");
	});

	it("keeps an IP-only (Apache) installation domainless instead of inventing DOMAIN=localhost", async () => {
		// This is what install.sh writes for an install without DOMAIN: loopback origins only.
		const result = await runUpgrade('DOMAIN=""\nSSH_WS_ALLOWED_ORIGINS="http://localhost:3000,http://127.0.0.1:3000,http://192.0.2.10"\n');
		expect(result.code).toBe(0);
		expect(result.seen).toContain("DOMAIN=\n");
		expect(result.text).not.toContain("Recovered installed domain");
	});

	it("runs git with the checkout declared safe, so a root upgrade of the service user's checkout works", async () => {
		const script = await readFile(path.join(process.cwd(), "deploy/upgrade.sh"), "utf8");
		expect(script).toMatch(/git_app\(\) \{ git -c "safe\.directory=\$\{APP_DIR\}" -C "\$\{APP_DIR\}" "\$@"; \}/);
		expect(script).not.toContain('git -C "${APP_DIR}"');
	});

describeLinux("deploy/upgrade.sh pulling a one-click install", () => {
	const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" }).trim();

	/** An origin, an installed clone of it, and a newer commit on the origin. */
	async function installedClone() {
		const root = await mkdtemp(path.join(tmpdir(), "vch-upgrade-pull-"));
		roots.push(root);
		const origin = path.join(root, "origin");
		await mkdir(path.join(origin, "docs"), { recursive: true });
		git(origin, "init", "-q");
		await writeFile(path.join(origin, "docs/route-catalog.json"), '{"generatedAt":"2026-10-21T00:00:00Z"}\n');
		await writeFile(path.join(origin, "README.md"), "v1\n");
		git(origin, "add", "-A");
		git(origin, "commit", "-q", "-m", "v1");
		const app = path.join(root, "app");
		git(root, "clone", "-q", origin, app);
		await writeFile(path.join(origin, "README.md"), "v2\n");
		await writeFile(path.join(origin, "docs/route-catalog.json"), '{"generatedAt":"2026-10-26T00:00:00Z","new":true}\n');
		git(origin, "commit", "-q", "-am", "v2");
		await writeFile(path.join(app, ".env.local"), 'SSH_WS_ALLOWED_ORIGINS="https://console.example.com"\n', { mode: 0o600 });
		await writeFile(path.join(app, ".git/info/exclude"), ".env.local\n");
		return { root, app, head: git(origin, "rev-parse", "HEAD") };
	}

	async function upgrade(root: string, app: string) {
		return invoke(app, { ...await fixtureCommands(root), UPGRADE_REF: "main", SKIP_POST_CHECK: "1" });
	}

	it("updates a checkout whose route catalog the installer's build rewrote", async () => {
		// The build regenerates docs/route-catalog.json; every update of a
		// one-click install stopped at "Working tree has local changes".
		const { root, app, head } = await installedClone();
		await writeFile(path.join(app, "docs/route-catalog.json"), '{"generatedAt":"2026-10-26T09:15:12Z"}\n');
		const result = await upgrade(root, app);
		expect(result.text).not.toContain("Working tree has local changes");
		expect(result.code).toBe(0);
		expect(git(app, "rev-parse", "HEAD")).toBe(head);
	});

	it("builds only the pinned local commit using installed env and keeps repository authentication for the next fetch", async () => {
		const { root, app, head } = await installedClone();
		const origin = path.join(root, "origin");
		const remote = "private-vch:test";
		git(app, "remote", "set-url", "origin", remote);
		git(app, "config", `url.${origin}.insteadOf`, remote);
		git(app, "config", "core.sshCommand", "ssh -i /private/deploy-key");
		await writeFile(path.join(origin, ".env.production.local"), "NEXT_PUBLIC_APP_TIME_ZONE=release-zone\n");
		await writeFile(path.join(origin, ".env.preview"), "RELEASE_ONLY=1\n");
		git(origin, "add", "-f", ".env.production.local", ".env.preview");
		git(origin, "commit", "-qm", "release env");
		git(app, "fetch", "origin", "main");
		const pinned = git(app, "rev-parse", "FETCH_HEAD");
		expect(pinned).not.toBe(head);
		await writeFile(path.join(origin, "README.md"), "branch moved\n");
		git(origin, "commit", "-qam", "advance branch");
		await writeFile(path.join(app, ".env.production.local"), "NEXT_PUBLIC_APP_TIME_ZONE=Europe/Berlin\nTOOL_ENV=selected-production-local\n");
		const env = await fixtureCommands(root);
		const seen = path.join(root, "build-env");
		const result = await invoke(app, { ...env, UPGRADE_COMMIT: pinned, OBSERVE_ENV: seen, SKIP_POST_CHECK: "1",
			ENV_FILE: path.join(app, ".env.production.local"), EXPECT_TOOL_ENV: "selected-production-local" });
		expect(result.code, result.text).toBe(0);
		expect(await readFile(seen, "utf8")).toBe("Europe/Berlin");
		expect(git(app, "rev-parse", "HEAD")).toBe(pinned);
		expect(git(app, "config", "--get", "core.sshCommand")).toBe("ssh -i /private/deploy-key");
		expect(git(app, "config", "--get", "remote.origin.url")).toBe(remote);
		git(app, "fetch", "origin", "main");
		expect(git(app, "rev-parse", "FETCH_HEAD")).toBe(git(origin, "rev-parse", "HEAD"));
		await expect(stat(path.join(app, ".env.preview"))).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("restores a single-file driver from a previous bootstrap using the already fetched tree", async () => {
		const { root, app } = await installedClone();
		const origin = path.join(root, "origin");
		await mkdir(path.join(origin, "deploy/lib"), { recursive: true });
		for (const file of ["upgrade.sh", "lib/listen-address.sh", "lib/release-paths.sh"]) {
			await writeFile(path.join(origin, "deploy", file), await readFile(path.join("deploy", file)));
		}
		git(origin, "add", "deploy");
		git(origin, "commit", "-qm", "staged driver");
		git(app, "fetch", "origin", "main");
		const pinned = git(app, "rev-parse", "FETCH_HEAD");
		const standalone = path.join(root, "upgrade.sh");
		await writeFile(standalone, execFileSync("git", ["-C", app, "show", "FETCH_HEAD:deploy/upgrade.sh"]));
		await writeFile(path.join(origin, "README.md"), "new branch tip\n");
		git(origin, "commit", "-qam", "advance after bootstrap");
		const env = { ...await fixtureCommands(root), UPGRADE_REF: "main", SKIP_POST_CHECK: "1" };
		const result = await invoke(app, env, standalone);
		expect(result.code, result.text).toBe(0);
		expect(git(app, "rev-parse", "HEAD")).toBe(pinned);
	});

	it("still refuses to update over a change someone made", async () => {
		const { root, app } = await installedClone();
		await writeFile(path.join(app, "README.md"), "edited on the server\n");
		const result = await upgrade(root, app);
		expect(result.code).not.toBe(0);
		expect(result.text).toContain("Working tree has local changes");
	});
});
});


describeLinux("archive upgrade environment files", () => {
	it.each(["installed tree", "separate archive"])("preserves the installed environment when staging from the %s", async source => {
		const root = await mkdtemp(path.join(tmpdir(), "vch-upgrade-env-"));
		roots.push(root);
		const app = path.join(root, "app");
		await mkdir(app);
		const custom = path.join(app, ".env.custom");
		await writeFile(custom, "installed settings\n", { mode: 0o600 });
		const original = await stat(custom);
		await writeFile(path.join(app, ".env.local"), 'DOMAIN=""\nNEXT_PUBLIC_APP_TIME_ZONE=Asia/Shanghai\n');
		await writeFile(path.join(app, ".env.production.local"), "NEXT_PUBLIC_APP_TIME_ZONE=Europe/Berlin\n");
		await writeFile(path.join(app, ".env.example"), "installed template\n");

		const env = await fixtureCommands(root);
		const separate = source === "separate archive";
		const sourceDir = separate ? path.join(root, "release") : app;
		if (separate) {
			await mkdir(sourceDir);
			await writeFile(path.join(sourceDir, ".env.custom"), "archive settings\n");
			await writeFile(path.join(sourceDir, ".env.preview"), "archive-only settings\n");
			await writeFile(path.join(sourceDir, ".env.example"), "release template\n");
		}

		const state = "tenant custom state";
		await mkdir(path.join(app, state));
		await writeFile(path.join(app, state, "data"), "initial\n");
		const stateInode = (await stat(path.join(app, state))).ino;
		const seen = path.join(root, "build-env");
		const result = await invoke(app, { ...env, OBSERVE_ENV: seen, STATE_DIR: state, SOURCE_DIR: sourceDir, SKIP_PULL: "1", SKIP_POST_CHECK: "1" });
		expect(result.code, result.text).toBe(0);
		expect(await readFile(seen, "utf8")).toBe("Europe/Berlin");
		expect(await readFile(path.join(app, state, "data"), "utf8")).toBe("initial\nlate-write\n");
		expect((await stat(path.join(app, state))).ino).toBe(stateInode);
		expect(await readFile(custom, "utf8")).toBe("installed settings\n");
		expect(await stat(custom)).toMatchObject({ ino: original.ino, mode: original.mode });
		expect(await readFile(path.join(app, ".env.example"), "utf8")).toBe(separate ? "release template\n" : "installed template\n");
		await expect(stat(path.join(app, ".env.preview"))).rejects.toMatchObject({ code: "ENOENT" });
	});
});

describeLinux("staged release recovery", () => {
	it.each(["build", "start", "health"])("recovers from %s failure", async fail => {
		const result = await runUpgrade('DOMAIN=""\n', { FAIL: fail });
		expect(result.code, result.text).not.toBe(0);
		expect(await readFile(path.join(result.app, "dist/server.js"), "utf8")).toBe("old");
		expect(await readFile(path.join(result.app, "storage/customer-file"), "utf8")).toBe("retained");
		expect(await readFile(path.join(result.app, ".env.local"), "utf8")).toBe('DOMAIN=""\n');
		if (fail === "build") expect(result.log).not.toContain("systemctl stop");
		else {
			expect(result.log.indexOf("npm run build:runtime")).toBeLessThan(result.log.indexOf("systemctl stop"));
			expect(result.log.trim().split("\n").at(-1)).toBe("systemctl start vcontrolhub-next.service vcontrolhub-ssh-ws.service");
		}
	});
});

describe("ALTER TABLE migration classification", () => {
	it("accepts multiple explicit additions with nested or quoted commas", () => {
		expect(isAutomaticMigration(`
			ALTER TABLE IF EXISTS ONLY public."t,1"
				ADD COLUMN IF NOT EXISTS "a,b" numeric(12, 2),
				ADD COLUMN label text DEFAULT 'x,y',
				ADD CONSTRAINT label_fk FOREIGN KEY (label) REFERENCES labels(name) NOT VALID;
		`)).toBe(true);
	});

	it.each([
		"ADD COLUMN a text NOT NULL DEFAULT 'value'",
		"ADD COLUMN a integer DEFAULT 0 NOT /* required */ NULL",
		'ADD COLUMN "NOT NULL" text',
		'ADD CONSTRAINT "fk" FOREIGN KEY (a, b) REFERENCES public.t2(x, y) ON DELETE SET DEFAULT NOT VALID',
	])("accepts %s", actions => {
		expect(isAutomaticMigration(`ALTER TABLE t ${actions};`)).toBe(true);
	});

	it.each([
		"ADD COLUMN a int, DISABLE TRIGGER ALL",
		"ENABLE ROW LEVEL SECURITY, ADD COLUMN a int",
		"ADD COLUMN a numeric(10, 2), OWNER TO new_owner, ADD COLUMN b int",
		"ADD COLUMN a int, ADD unknown_action",
		"ADD COLUMN a text NOT NULL",
		'ADD COLUMN "DEFAULT" text NOT NULL /* DEFAULT placeholder */',
		"ADD COLUMN a integer NOT NULL DEFAULT (NULL)",
		"ADD COLUMN a text DEFAULT 'DEFAULT', ADD COLUMN b text NOT NULL",
		"ADD COLUMN a int NOT NULL REFERENCES parents(id) ON DELETE SET DEFAULT",
		"ADD COLUMN a int DEFAULT 1 UNIQUE",
		"ADD COLUMN a int CHECK (a IS NULL)",
		"ADD CONSTRAINT positive CHECK (a IN (1, 2))",
		"ADD CONSTRAINT positive CHECK (a IN (1, 2)) NOT VALID",
		"ADD CONSTRAINT distinct_pair UNIQUE (a, b)",
		"ADD CONSTRAINT pk PRIMARY KEY (a)",
		"ADD CONSTRAINT required NOT NULL a",
		"ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES t2(b) /* NOT VALID */",
		'ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES "NOT VALID"(b)',
	])("requires review for %s", actions => {
		expect(isAutomaticMigration(`ALTER TABLE t ${actions};`)).toBe(false);
	});
});

describeLinux("automatic migration preflight", () => {
	it("checks only pending SQL and refuses destructive or unrecognised changes", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "vch-upgrade-ledger-"));
		roots.push(root);
		const bin = path.join(root, "psql");
		await writeFile(bin, '#!/bin/sh\nprintf "%s\\n" "$LEDGER"\n', { mode: 0o755 });
		const sql = "DROP TABLE legacy;";
		const { createHash } = await import("node:crypto");
		const ledger = [{ name: "001", done: true, checksum: createHash("sha256").update(sql).digest("hex") }];
		const dirs = ["001", "002"].map(id => path.join(root, "prisma/migrations", id));
		for (const dir of dirs) await mkdir(dir, { recursive: true });
		await writeFile(path.join(dirs[0]!, "migration.sql"), sql);
		const run = () => execFileSync(process.execPath, [path.resolve("deploy/check-upgrade-migrations.mjs")], {
			cwd: root, stdio: "pipe", env: { ...process.env, PATH: root, DATABASE_URL: "postgres://unused/test", LEDGER: JSON.stringify(ledger) },
		});
		for (const pending of ["CREATE TABLE t (id integer);", 'ALTER TABLE "t" ADD COLUMN x integer;']) {
			await writeFile(path.join(dirs[1]!, "migration.sql"), pending);
			expect(run).not.toThrow();
		}
		for (const pending of [
			"DROP TABLE t", "ALTER TABLE t ADD x int, DROP /* comment */ COLUMN y", "UPDATE t SET x = NULL",
			"TRUNCATE t", "DELETE FROM t", "DO $$ BEGIN EXECUTE q; END $$",
			"ALTER TABLE t ADD COLUMN required integer NOT NULL", "ALTER TABLE t ADD CONSTRAINT uq UNIQUE (id)",
		]) {
			await writeFile(path.join(dirs[1]!, "migration.sql"), pending);
			expect(run).toThrow(/Manual migration review.*002/);
		}
	});
});
