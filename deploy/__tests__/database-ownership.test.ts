// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const roots: string[] = [];
const localUrl = "postgresql://app_role:test@127.0.0.1:5432/app_db";
const remoteUrl = "postgresql://app_role:private@pg.example.net:6432/app_db";

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), "vch-db-ownership-"));
	roots.push(root);
	const envFile = path.join(root, ".env.local");
	const runtime = path.join(root, ".env.runtime");
	const state = path.join(root, "database");
	const [installSource, uninstallSource] = await Promise.all(
		["install", "uninstall"].map(file => readFile(`deploy/${file}.sh`, "utf8")),
	);
	function fn(source: string, name: string) {
		const start = source.indexOf(`${name}() {`);
		expect(start).toBeGreaterThanOrEqual(0);
		return source.slice(start, source.indexOf("\n}\n", start) + 2);
	}
	const install = ["setup_postgres", "write_database_record", "record_external_database",
		"urlencode", "set_env_var", "sql_literal", "shell_escape_sed_replacement"].map(n => fn(installSource!, n)).join("\n");
	const uninstall = ["load_owned_database", "plan_database_cleanup", "check_database_cluster",
		"remove_owned_database"].map(n => fn(uninstallSource!, n)).join("\n");
	function bash(body: string, env: Record<string, string> = {}) {
		return run("bash", ["-c", `set -euo pipefail
log() { echo "$*"; }
warn() { echo "$*" >&2; }
fail() { warn "$@"; exit 1; }
${body}`], {
			cwd: root,
			env: {
				...process.env, APP_DIR: root, ENV_FILE: envFile, RUNTIME_ENV_FILE: runtime,
				INSTANCE_STATE_DIR: root, DATABASE_URL: "", CLUSTER: "98765", PG_AUTO_SETUP: "1", SKIP_DB_SETUP: "0",
				PG_DB_USER: "app_role", PG_DB_NAME: "app_db", PG_DB_PASSWORD: "test", ...env,
			},
		});
	}
	// Catalog lookups and create operations affect only these temporary fixture files.
	const setup = `${install}
have_cmd() { return 0; }
systemctl() { return 0; }
run_as_postgres() {
  echo "$*" >> postgres.calls
  case "$*" in
    *pg_control_system*) echo 98765 ;;
    *"SELECT oid FROM pg_roles"*) cat role.oid ;;
    *"SELECT oid FROM pg_database"*) cat db.oid ;;
    *"CREATE USER"*) echo 123 > role.oid ;;
    createdb*) echo 456 > db.oid ;;
  esac
}
setup_postgres`;
	// A remote/unmarked target must never reach this function, even for a probe.
	const cleanup = `${uninstall}
local_admin_psql() {
  echo "$*" >> postgres.calls
  if [[ $1 == -c ]]; then echo "$CLUSTER"; else cat >> postgres.calls; fi
}
plan_database_cleanup
check_database_cluster
remove_owned_database`;
	await Promise.all([envFile, "postgres.calls", "role.oid", "db.oid"].map(f => writeFile(path.resolve(root, f), "")));
	return { root, bash, setup, cleanup, envFile, runtime, state,
		calls: () => readFile(path.join(root, "postgres.calls"), "utf8") };
}

describe.skipIf(process.platform === "win32")("PostgreSQL installation ownership", () => {
	it.each([remoteUrl, localUrl])("records a supplied endpoint without its credentials and never invokes postgres", async url => {
		const f = await fixture();
		await f.bash(f.setup, { DATABASE_URL: url });
		const [mode, endpoint] = (await readFile(f.state, "utf8")).trim().split("\n");
		expect(mode).toBe("external");
		const parsed = new URL(url);
		expect(JSON.parse(endpoint!)).toEqual({
			host: parsed.hostname, port: Number(parsed.port), database: "app_db", role: "app_role",
		});
		await writeFile(f.envFile, `DATABASE_URL="${url}"\n`);
		expect((await f.bash(f.cleanup)).stderr).toContain("manual handling");
		expect(await f.calls()).toBe("");
	});

	it.each([
		["unmarked loopback", localUrl, false],
		["remote runtime overrides the local file", remoteUrl, true],
		["port changed", localUrl.replace("5432", "5433"), true],
		["invalid port zero", localUrl.replace("5432", "0"), true],
		["continued URL with an ambiguous target", localUrl + "?schema=public\\\n&host=remote", true],
		["database changed", localUrl.replace("app_db", "other"), true],
		["role changed", localUrl.replace("app_role", "other"), true],
		["connection parameter overrides the host", localUrl + "?host=remote", true],
	])("skips even the connectivity probe for %s", async (_reason, target, receipt) => {
		const f = await fixture();
		if (receipt) await writeFile(f.state, `local 5432 app_db app_role 98765 456 123\n${f.envFile}\n${f.runtime}\n`);
		await writeFile(f.envFile, `DATABASE_URL='${localUrl}'\n`);
		await writeFile(f.runtime, `DATABASE_URL='${localUrl}'\nDATABASE_URL='${target}'\n`);
		expect((await f.bash(f.cleanup)).stderr).toContain("manual handling");
		expect(await f.calls()).toBe("");
	});

	it("keeps a remote URL operator-managed when its query ends in the generated local address", async () => {
		const f = await fixture();
		await f.bash(f.setup);
		const misleading = `${remoteUrl}?tag=@127.0.0.1:5432/app_db`;
		await f.bash(f.setup, { DATABASE_URL: misleading });
		expect((await readFile(f.state, "utf8")).split("\n")[0]).toBe("external");
	});

	it("resolves a custom runtime symlink at uninstall and ignores apparent assignments in multiline values", async () => {
		const f = await fixture();
		const link = path.join(f.root, "custom-runtime");
		const remote = path.join(f.root, "external-runtime");
		await symlink(f.envFile, link);
		await f.bash(f.setup, { RUNTIME_ENV_FILE: link });
		await writeFile(remote, `DATABASE_URL="${remoteUrl}"\nOTHER="line\nDATABASE_URL=${localUrl}\nend"\n`);
		await rm(link);
		await symlink(remote, link);
		await writeFile(path.join(f.root, "postgres.calls"), "");
		expect((await f.bash(f.cleanup, { RUNTIME_ENV_FILE: "" })).stderr).toContain("manual handling");
		expect(await f.calls()).toBe("");
	});

	it("rechecks both the runtime endpoint and receipt after confirmation", async () => {
		const f = await fixture();
		await f.bash(f.setup, { DATABASE_URL: "REPLACE_WITH_DATABASE_URL" });
		await writeFile(f.runtime, await readFile(f.envFile));
		for (const change of [
			'echo "DATABASE_URL=$REMOTE_URL" > "$RUNTIME_ENV_FILE"',
			'sed -i "1s/456/987/" "$INSTANCE_STATE_DIR/database"',
		]) {
			await writeFile(path.join(f.root, "postgres.calls"), "");
			await writeFile(f.runtime, await readFile(f.envFile));
			const changed = f.cleanup.replace("check_database_cluster\nremove_owned_database", `check_database_cluster\n${change}\nremove_owned_database`);
			expect((await f.bash(changed, { REMOTE_URL: remoteUrl })).stderr).toContain("ownership changed");
			expect(await f.calls()).not.toContain("DROP");
		}
	});

	it.each([
		["", "", "456", "123"], ["55", "", "0", "123"], ["", "66", "456", "0"], ["55", "66", "0", "0"],
	])("records individual creation receipts when db=%s / role=%s pre-exist", async (db, role, dbOid, roleOid) => {
		const f = await fixture();
		await writeFile(path.join(f.root, "db.oid"), db);
		await writeFile(path.join(f.root, "role.oid"), role);
		await f.bash(f.setup);
		await writeFile(f.runtime, await readFile(f.envFile));
		const state = await readFile(f.state, "utf8");
		expect(state.split("\n")[0]).toBe(`local 5432 app_db app_role 98765 ${dbOid} ${roleOid}`);
		expect(await f.calls()).not.toContain("ALTER USER");
		await f.bash(f.setup, { DATABASE_URL: localUrl });
		expect(await readFile(f.state, "utf8")).toBe(state);
		await writeFile(path.join(f.root, "postgres.calls"), "");
		await f.bash(f.cleanup, { CLUSTER: "999" });
		expect(await f.calls()).not.toContain("DROP");
		await f.bash(f.cleanup);
		if (dbOid === "0" && roleOid === "0") {
			expect(await f.calls()).toBe("");
		} else {
			expect(await f.calls()).toContain(`db_oid=${dbOid} -v role_oid=${roleOid}`);
			expect(await f.calls()).toContain("system_identifier = :'cluster' AND oid = :'db_oid' AND datname = :'db'");
			expect(await f.calls()).toContain("system_identifier = :'cluster' AND oid = :'role_oid' AND rolname = :'role'");
		}
	});
});
