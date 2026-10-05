// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const describeLinux = process.platform === "linux" ? describe : describe.skip;

async function fixture(mode: "build-fail" | "probe-fail" | "good") {
	const root = await mkdtemp(path.join(tmpdir(), "vch-staged-deploy-"));
	roots.push(root);
	const app = path.join(root, "app");
	const bin = path.join(root, "bin");
	const units = path.join(root, "units");
	for (const dir of [app, bin, units, path.join(app, "scripts"), path.join(app, "deploy")]) await mkdir(dir, { recursive: true });
	for (const artifact of [".next", "dist", "node_modules"]) {
		await mkdir(path.join(app, artifact));
		await writeFile(path.join(app, artifact, "version"), "previous");
	}
	await writeFile(path.join(app, "scripts/check-ssh-gateway.mjs"), "// fixture gateway helper\n");
	await writeFile(path.join(app, ".env.runtime"), "SSH_WS_ALLOWED_ORIGINS=https://fixture.example.test\n", { mode: 0o600 });
	await mkdir(path.join(app, "storage"), { mode: 0o700 });
	await writeFile(path.join(app, "storage/private-data"), "existing data", { mode: 0o600 });
	await writeFile(path.join(app, "deploy/smoke-test.sh"), "#!/bin/bash\nexit 0\n");
	await writeFile(path.join(units, "fixture-next.service"), "Description=previous\nExecStart=/opt/fixture/dist/server.js\n");
	await writeFile(path.join(units, "fixture-worker.service"), "Description=custom-worker-preserved\n");
	const log = path.join(root, "commands.log");
	await writeFile(path.join(bin, "systemctl"), '#!/bin/bash\nprintf "systemctl %s\\n" "$*" >> "$DEPLOY_TEST_LOG"\ncase "$*" in *vcontrolhub-direct*) exit 1;; esac\nexit 0\n', { mode: 0o755 });
	await writeFile(path.join(bin, "sudo"), `#!/bin/bash
printf 'build %s\\n' "$*" >> "$DEPLOY_TEST_LOG"
if [[ "$*" == *'npm run build'* && "$*" != *'build:runtime'* ]]; then
  [ "$DEPLOY_TEST_MODE" != 'build-fail' ] || exit 41
  mkdir -p .next
  printf candidate > .next/BUILD_ID
fi
if [[ "$*" == *'build:runtime'* ]]; then
  mkdir -p dist node_modules
  for name in server worker ssh-ws-proxy upload-recovery-backup; do printf candidate > "dist/$name.js"; done
  for dir in .next dist node_modules; do printf candidate > "$dir/version"; done
fi
exit 0
`, { mode: 0o755 });
	await writeFile(path.join(bin, "node"), '#!/bin/bash\nprintf "probe %s\\n" "$*" >> "$DEPLOY_TEST_LOG"\n[ "$DEPLOY_TEST_MODE" != "probe-fail" ]\n', { mode: 0o755 });
	return { root, app, units, log, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, APP_DIR: app, APP_USER: (await import("node:os")).userInfo().username, SERVICE_NAME: "fixture-next", WORKER_SERVICE_NAME: "fixture-worker", SSH_SERVICE_NAME: "fixture-ssh-ws", SYSTEMD_UNIT_DIR: units, DEPLOY_LOCK: path.join(root, "deploy.lock"), CADDY_FILE: path.join(root, "no-caddy"), DEPLOY_TEST_LOG: log, DEPLOY_TEST_MODE: mode } };
}

async function run(env: NodeJS.ProcessEnv) {
	const child = spawn("bash", [path.resolve("deploy.sh")], { env, stdio: ["ignore", "pipe", "pipe"] });
	let output = "";
	child.stdout.on("data", chunk => { output += chunk; });
	child.stderr.on("data", chunk => { output += chunk; });
	return await new Promise<{ code: number | null; output: string }>(resolve => child.on("close", code => resolve({ code, output })));
}

describeLinux("staged deployment and recovery", () => {
	it("leaves the live runtime and services untouched when the candidate build fails", async () => {
		const f = await fixture("build-fail");
		expect((await run(f.env)).code).toBe(41);
		for (const artifact of [".next", "dist", "node_modules"]) expect(await readFile(path.join(f.app, artifact, "version"), "utf8")).toBe("previous");
		expect(await readFile(f.log, "utf8")).not.toContain("systemctl stop");
		expect((await readdir(f.root)).some(name => name.startsWith(".vcontrolhub-build"))).toBe(false);
	});

	it("restores complete previous artifacts and custom units after a failed protocol gate", async () => {
		const f = await fixture("probe-fail");
		const result = await run(f.env);
		expect(result.code).toBe(1);
		for (const artifact of [".next", "dist", "node_modules"]) expect(await readFile(path.join(f.app, artifact, "version"), "utf8")).toBe("previous");
		expect(await readFile(path.join(f.units, "fixture-worker.service"), "utf8")).toBe("Description=custom-worker-preserved\n");
		expect(await readFile(path.join(f.app, "storage/private-data"), "utf8")).toBe("existing data");
		expect((await stat(path.join(f.app, "storage/private-data"))).mode & 0o777).toBe(0o600);
		expect((await stat(path.join(f.app, "storage"))).mode & 0o777).toBe(0o700);
		expect(await readFile(f.log, "utf8")).toContain("systemctl start fixture-next fixture-ssh-ws");
	});

	it("promotes only a built candidate and keeps the old runtime available for rollback", async () => {
		const f = await fixture("good");
		const result = await run(f.env);
		expect(result.code, result.output).toBe(0);
		for (const artifact of [".next", "dist", "node_modules"]) expect(await readFile(path.join(f.app, artifact, "version"), "utf8")).toBe("candidate");
		const rollback = (await readdir(f.root)).find(name => name.startsWith(".vcontrolhub-rollback"))!;
		expect(await readFile(path.join(f.root, rollback, ".next/version"), "utf8")).toBe("previous");
		const commands = await readFile(f.log, "utf8");
		expect(commands.indexOf("npm run build:runtime")).toBeLessThan(commands.indexOf("systemctl stop"));
		expect(await readFile(path.join(f.root, "deploy.lock"), "utf8")).toBe("");
		expect(await readFile(path.join(f.units, "fixture-worker.service"), "utf8")).toBe("Description=custom-worker-preserved\n");
	});
});
