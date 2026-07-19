import { execFileSync } from "node:child_process";
import { realpathSync, readlinkSync } from "node:fs";

// CI / non-Linux / explicit authorize: never block the build.
// GitHub Actions sets CI=true and GITHUB_ACTIONS=true; local deploy uses
// VCONTROLHUB_DEPLOY_BUILD=1 after stopping the service.
if (process.platform !== "linux") process.exit(0);
if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") process.exit(0);
if (process.env.VCONTROLHUB_ALLOW_BUILD === "1") process.exit(0);

const service = process.env.NEXT_SYSTEMD_SERVICE || "vcontrolhub-next.service";
try {
	const state = execFileSync("systemctl", ["is-active", service], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	if (process.env.VCONTROLHUB_DEPLOY_BUILD === "1") {
		if (state === "active") {
			console.error(`Refusing authorized build because ${service} is still active.`);
			process.exit(2);
		}
		process.exit(0);
	}
	if (state !== "active") {
		console.error(
			`Refusing an uncoordinated production build in ${process.cwd()}.\n` +
			"Use sudo bash deploy.sh; it owns the deployment lock and authorizes the build only after stopping the service.",
		);
		process.exit(2);
	}
	const pid = execFileSync("systemctl", ["show", service, "-p", "MainPID", "--value"], { encoding: "utf8" }).trim();
	if (!pid || pid === "0") process.exit(0);
	const serviceCwd = realpathSync(readlinkSync(`/proc/${pid}/cwd`));
	const buildCwd = realpathSync(process.cwd());
	if (serviceCwd !== buildCwd) process.exit(0);

	console.error(
		`Refusing to overwrite .next while ${service} is serving ${buildCwd}.\n` +
		"Use sudo bash deploy.sh so the deployment is locked, the service is stopped, and smoke checks run before handoff.",
	);
	process.exit(2);
} catch {
	if (process.env.VCONTROLHUB_DEPLOY_BUILD === "1") process.exit(0);
	console.error(`Unable to verify ${service}; refusing an uncoordinated production build.`);
	process.exit(2);
}
