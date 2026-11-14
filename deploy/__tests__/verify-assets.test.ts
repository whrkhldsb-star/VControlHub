// @vitest-environment node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `deploy/verify-assets.sh` checks the shell entrypoints parse, the systemd units render and pass
 * `systemd-analyze verify`, and the Compose file is valid. Only `npm run verify` ran it; the CI jobs run their
 * steps one by one and none of them called it, so a broken unit template or entrypoint could reach main with
 * every required check green. The Linux test job runs it from here.
 */
const hasSystemdAnalyze =
	process.platform === "linux" && spawnSync("systemd-analyze", ["--version"], { stdio: "ignore" }).status === 0;

describe.skipIf(!hasSystemdAnalyze)("deployment assets", () => {
	it("pass the deployment asset check", () => {
		const result = spawnSync("bash", [path.join(process.cwd(), "deploy", "verify-assets.sh")], {
			encoding: "utf8",
			timeout: 120_000,
		});
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
		expect(result.stdout).toContain("deploy-assets-ok");
	}, 130_000);
});
