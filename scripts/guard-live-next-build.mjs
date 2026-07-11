import { execFileSync } from "node:child_process";
import { realpathSync, readlinkSync } from "node:fs";

if (process.env.ALLOW_LIVE_NEXT_BUILD === "1" || process.platform !== "linux") process.exit(0);

const service = process.env.NEXT_SYSTEMD_SERVICE || "vcontrolhub-next.service";
try {
	const state = execFileSync("systemctl", ["is-active", service], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	if (state !== "active") process.exit(0);
	const pid = execFileSync("systemctl", ["show", service, "-p", "MainPID", "--value"], { encoding: "utf8" }).trim();
	if (!pid || pid === "0") process.exit(0);
	const serviceCwd = realpathSync(readlinkSync(`/proc/${pid}/cwd`));
	const buildCwd = realpathSync(process.cwd());
	if (serviceCwd !== buildCwd) process.exit(0);

	console.error(
		`Refusing to overwrite .next while ${service} is serving ${buildCwd}.\n` +
		"Use sudo bash deploy.sh so the service is stopped before build and restarted with smoke checks.",
	);
	process.exit(2);
} catch {
	// No usable systemd/service metadata: keep normal developer builds working.
	process.exit(0);
}
