import { execFileSync } from "child_process";

/**
 * Synchronous wrapper around the `docker` CLI used by quick-service lifecycle
 * operations (install / start / stop / update / sync / status probes).
 *
 * Centralises the stdio / encoding / timeout shape so call sites only need to
 * pass docker subcommand args, and keeps `docker` binary-specific error
 * mapping (ENOENT / not-found) inside the adapter rather than leaking that
 * knowledge into every caller.
 */

export function dockerExecSync(args: string[], timeout = 30_000): string {
	return execFileSync("docker", args, {
		timeout,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

export function dockerErrorMessage(error: unknown): string {
	if (error && typeof error === "object") {
		const maybe = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
		const stderr = typeof maybe.stderr === "string" ? maybe.stderr.trim() : "";
		const stdout = typeof maybe.stdout === "string" ? maybe.stdout.trim() : "";
		const message = typeof maybe.message === "string" ? maybe.message.trim() : "";
		return stderr || stdout || message || String(error);
	}
	return String(error);
}

export function getContainerHealth(containerName: string, timeoutMs = 10_000): string | null {
	try {
		const health = dockerExecSync(
			[
				"inspect",
				"--format={{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
				containerName,
			],
			timeoutMs,
		).trim();
		return health || null;
	} catch {
		return null;
	}
}

export function getContainerLogTail(containerName: string, timeoutMs = 10_000): string | null {
	try {
		const logs = dockerExecSync(["logs", "--tail", "20", containerName], timeoutMs).trim();
		if (!logs) return null;
		return logs.slice(-2000);
	} catch {
		return null;
	}
}

export type DockerEnvironmentStatus = {
	available: boolean;
	running: boolean;
	version: string | null;
	message: string | null;
	installHint: string | null;
};

export function getDockerEnvironmentStatus(): DockerEnvironmentStatus {
	const DOCKER_INSTALL_HINT =
		"Quick services depend on Docker. Please run curl -fsSL https://get.docker.com | sh first, and confirm systemctl enable --now docker.";
	try {
		const version = execFileSync("docker", ["--version"], {
			timeout: 5_000,
			encoding: "utf8",
		}).trim();
		execFileSync("docker", ["info"], { timeout: 10_000, stdio: "pipe" });
		return {
			available: true,
			running: true,
			version,
			message: null,
			installHint: null,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const notInstalled = /ENOENT|not found|no such file/i.test(message);
		return {
			available: false,
			running: false,
			version: null,
			message: notInstalled
				? "Docker is not installed"
				: "Docker is not running or the current user has no permission to access the Docker daemon",
			installHint: DOCKER_INSTALL_HINT,
		};
	}
}
