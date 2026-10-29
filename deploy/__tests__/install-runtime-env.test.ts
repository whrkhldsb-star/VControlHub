// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const describeLinux = process.platform === "linux" ? describe : describe.skip;

/** The Python the installer runs to write .env.runtime, lifted out of install.sh as it is. */
async function runtimeEnvScript() {
	const source = await readFile("deploy/install.sh", "utf8");
	const match = /create_runtime_env_file\(\)[\s\S]*?python3 - [^\n]*<<'PY'\n([\s\S]*?)\nPY\n/.exec(source);
	if (!match) throw new Error("runtime env script not found in install.sh");
	return match[1]!;
}

async function generate(envLocal: string, envRuntime: string) {
	const root = await mkdtemp(path.join(tmpdir(), "vch-runtime-env-"));
	roots.push(root);
	const script = path.join(root, "gen.py");
	const source = path.join(root, ".env.local");
	const dest = path.join(root, ".env.runtime");
	await writeFile(script, await runtimeEnvScript());
	await writeFile(source, envLocal);
	await writeFile(dest, envRuntime);
	const result = spawnSync("python3", [script, source, dest], { encoding: "utf8" });
	return { status: result.status, stderr: result.stderr, runtime: await readFile(dest, "utf8") };
}

describeLinux("deploy/install.sh runtime environment file", () => {
	it("takes DATABASE_URL from the env file, which is what the migrations and the seed used", async () => {
		// It used to be kept from the old runtime file: the new database was migrated and seeded, the service
		// kept connecting to the old one.
		const { status, runtime } = await generate(
			'DATABASE_URL="postgresql://u:NEWPASS@db.new/app"\nPORT=3000\n',
			'DATABASE_URL="postgresql://u:OLDPASS@db.old/app"\n',
		);
		expect(status).toBe(0);
		expect(runtime).toContain("NEWPASS");
		expect(runtime).not.toContain("OLDPASS");
	});

	it("keeps the secrets the running service already holds, and says so when the env file differs", async () => {
		const { runtime, stderr } = await generate(
			'AUTH_SESSION_SECRET="brand-new-secret-value-0123456789"\nENCRYPTION_KEY="same-key-0123456789abcdef"\n',
			'AUTH_SESSION_SECRET="old-secret-value-0123456789abcd"\nENCRYPTION_KEY="same-key-0123456789abcdef"\n',
		);
		expect(runtime).toContain("old-secret-value-0123456789abcd");
		expect(runtime).not.toContain("brand-new-secret-value");
		expect(stderr).toContain("WARNING: AUTH_SESSION_SECRET");
		// An unchanged value is not worth a warning.
		expect(stderr).not.toContain("ENCRYPTION_KEY");
	});
});
