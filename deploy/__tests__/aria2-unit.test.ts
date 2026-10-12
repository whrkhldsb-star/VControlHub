// @vitest-environment node
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildAria2Config, getAria2RuntimeConfig } from "@/lib/aria2/service";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const describeLinux = process.platform === "linux" ? describe : describe.skip;

function run(command: string, args: string[], env: Record<string, string>) {
	return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
		const child: ChildProcessWithoutNullStreams = spawn(command, args, { env: { ...process.env, ...env } });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

describeLinux("confined aria2 relay unit", () => {
	it("launches aria2c with the same options the application would write, plus the secret kept in a 0600 file", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "vch-aria2-unit-"));
		roots.push(root);
		const rpcDir = path.join(root, "rpc");
		const stub = path.join(root, "aria2c-stub.sh");
		// The stub stands in for aria2c: print argv, then the config it was given.
		await writeFile(stub, "#!/bin/bash\nprintf 'ARGS:%s\\n' \"$*\"\ncat \"${1#--conf-path=}\"\n", { mode: 0o755 });
		const env = { ARIA2_RPC_SECRET: "unit-test-secret", ARIA2_RPC_PORT: "6811", ARIA2_RPC_DIR: rpcDir, ARIA2_BIN: stub };
		const result = await run("bash", [path.join(process.cwd(), "deploy/aria2-daemon.sh")], env);
		expect(result.code, result.stderr).toBe(0);
		expect(result.stdout).toContain(`ARGS:--conf-path=${path.join(rpcDir, "aria2.unit.conf")}`);
		const expected = buildAria2Config(getAria2RuntimeConfig({ ...env, NODE_ENV: "test" }));
		const rendered = result.stdout.split("\n").filter((line) => !line.startsWith("ARGS:") && line !== "rpc-secret=unit-test-secret").join("\n").trim();
		expect(rendered).toBe(expected);
		expect(result.stdout).toContain("rpc-secret=unit-test-secret");
		// The secret never travels on argv.
		expect(result.stdout).not.toMatch(/ARGS:.*unit-test-secret/);
		const conf = await readFile(path.join(rpcDir, "aria2.unit.conf"), "utf8");
		expect(conf).toContain("rpc-secret=unit-test-secret");
		expect((await stat(path.join(rpcDir, "aria2.unit.conf"))).mode & 0o777).toBe(0o600);
	});

	it("refuses to start without an RPC secret", async () => {
		const result = await run("bash", [path.join(process.cwd(), "deploy/aria2-daemon.sh")], { ARIA2_BIN: "/bin/true" });
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("ARIA2_RPC_SECRET is required");
	});

	it("denies private, carrier-grade NAT, link-local and metadata ranges while keeping loopback for RPC", async () => {
		const unit = await readFile(path.join(process.cwd(), "deploy/systemd/vcontrolhub-aria2.service.example"), "utf8");
		const deny = unit.match(/^IPAddressDeny=(.*)$/m)?.[1]?.split(/\s+/) ?? [];
		for (const range of ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16", "fc00::/7", "fe80::/10"]) {
			expect(deny).toContain(range);
		}
		expect(unit).toMatch(/^IPAddressAllow=127\.0\.0\.0\/8 ::1$/m);
		expect(unit).toContain("ExecStart=/bin/bash {{APP_DIR}}/deploy/aria2-daemon.sh");
		expect(unit).toContain("EnvironmentFile={{RUNTIME_ENV_FILE}}");
		expect(unit).toContain("User={{APP_USER}}");
	});

	it("is installed by the installer and the hot-deploy script, which both set ARIA2_MANAGED_EXTERNALLY", async () => {
		const install = await readFile(path.join(process.cwd(), "deploy/install.sh"), "utf8");
		expect(install).toContain("for svc in next worker ssh-ws aria2; do");
		expect(install).toContain("set_env_var ARIA2_MANAGED_EXTERNALLY 1");
		expect(install).toMatch(/enable_units\+=\("\$\{SERVICE_PREFIX\}-aria2\.service"\)/);
		const deploy = await readFile(path.join(process.cwd(), "deploy.sh"), "utf8");
		expect(deploy).toContain("vcontrolhub-aria2.service.example");
		expect(deploy).toContain("ARIA2_MANAGED_EXTERNALLY=1");
		expect(deploy).toContain('systemctl enable "$ARIA2_SERVICE_NAME"');
		expect(deploy).toContain("aria2.service) target=");
	});
});
