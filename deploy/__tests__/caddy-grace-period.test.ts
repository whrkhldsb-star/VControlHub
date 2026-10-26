// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const lib = path.resolve("deploy/lib/caddy-grace-period.sh");
const describePosix = process.platform === "win32" ? describe.skip : describe;

/** Runs a helper on a Caddyfile with these contents. */
function run(fn: string, caddyfile: string) {
	const dir = mkdtempSync(path.join(tmpdir(), "vch-caddy-"));
	try {
		const file = path.join(dir, "Caddyfile");
		writeFileSync(file, caddyfile);
		try {
			return { out: execFileSync("bash", ["-c", `source "$1"; ${fn} "$2"`, "bash", lib, file], { encoding: "utf8" }), code: 0 };
		} catch (error) {
			return { out: "", code: (error as { status?: number }).status ?? 1 };
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describePosix("Caddy reload grace period", () => {
	// A WebSocket whose browser stopped reading held `systemctl reload caddy`
	// forever ("servers shutting down with eternal grace period"), and the
	// 10-26 deploy rolled back.
	it("adds grace_period inside a global block at the top", () => {
		expect(run("caddyfile_with_grace_period", "{\n\tauto_https disable_redirects\n}\nexample.test {\n\treverse_proxy 127.0.0.1:3000\n}\n").out)
			.toBe("{\n\tgrace_period 10s\n\tauto_https disable_redirects\n}\nexample.test {\n\treverse_proxy 127.0.0.1:3000\n}\n");
	});

	it("finds the global block after comments, and adds one where there is none", () => {
		expect(run("caddyfile_with_grace_period", "# managed\n\n{\n\tadmin off\n}\n").out).toBe("# managed\n\n{\n\tgrace_period 10s\n\tadmin off\n}\n");
		expect(run("caddyfile_with_grace_period", "# managed\nexample.test {\n\trespond ok\n}\n").out)
			.toBe("# managed\n{\n\tgrace_period 10s\n}\n\nexample.test {\n\trespond ok\n}\n");
	});

	it("tells a Caddyfile that has one from one that does not", () => {
		expect(run("caddyfile_has_grace_period", "{\n\tgrace_period 30s\n}\n").code).toBe(0);
		expect(run("caddyfile_has_grace_period", "{\n\tauto_https off\n}\n").code).toBe(1);
	});

	it("ships it in the installer's template, and the deploy adds it to older installs", () => {
		expect(readFileSync("deploy/Caddyfile.example", "utf8")).toMatch(/^\{\n\tauto_https disable_redirects\n(?:\t#.*\n)*\tgrace_period 10s\n\}/m);
		const deploy = readFileSync("deploy.sh", "utf8");
		expect(deploy).toContain('source "$DEPLOY_SCRIPT_DIR/deploy/lib/caddy-grace-period.sh"');
		expect(deploy).toContain('caddyfile_with_grace_period "$BACKUP" > "$NEW_FILE"');
		expect(deploy).toContain("timeout 120 systemctl reload caddy || systemctl restart caddy");
	});
});
