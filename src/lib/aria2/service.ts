import { writeFile, readFile, mkdir, unlink, chmod, readdir, lstat } from "fs/promises";
import { access, constants } from "fs/promises";
import path from "path";
import { isIPv6 } from "node:net";
import { randomUUID } from "node:crypto";
import { findExecutable, IS_WINDOWS } from "@/lib/runtime/platform-paths";
import { isValidTcpPort } from "@/lib/runtime/listen-port";
import {
	getMissingAria2BinaryMessage,
	isMissingAria2BinaryError,
	spawnAria2Detached,
} from "@/lib/aria2/command-runner";
import { postAria2Rpc } from "@/lib/aria2/provider-http";
import { formatBytes as formatBytesShared } from "@/lib/format/bytes";
import { t, type Locale } from "@/lib/i18n/service-translations";

/* ── Aria2 RPC Configuration ──────────────────────────────── */

const DEFAULT_RPC_PORT = 6800;

export type Aria2RuntimeConfig = {
	rpcHost: string;
	rpcPort: number;
	rpcSecret: string;
	rpcDir: string;
	rpcSession: string;
	rpcConf: string;
};

export function getAria2RuntimeConfig(env: Partial<NodeJS.ProcessEnv> = process.env): Aria2RuntimeConfig {
	const host = env.ARIA2_RPC_HOST?.trim() || "127.0.0.1";
	const rpcHost = isIPv6(host) ? `[${host}]` : host;
	const rpcPortText = env.ARIA2_RPC_PORT?.trim() || String(DEFAULT_RPC_PORT);
	const rpcPort = Number(rpcPortText);

	if (!isValidTcpPort(rpcPort)) {
		throw new Error("ARIA2_RPC_PORT must be a valid TCP port");
	}

	const rpcSecret = env.ARIA2_RPC_SECRET?.trim();
	if (!rpcSecret) throw new Error("ARIA2_RPC_SECRET is required");
	if (/REPLACE_WITH|CHANGE_ME|CHANGE_THIS|(?:^|_)default_token$/i.test(rpcSecret)) {
		throw new Error("ARIA2_RPC_SECRET contains a placeholder");
	}

	const appDir = env.APP_DIR?.trim() || process.cwd();
	const rpcDir = env.ARIA2_RPC_DIR?.trim() || path.join(appDir, "tmp", "aria2");
	const rpcSession = path.join(rpcDir, "aria2.session");
	const rpcConf = path.join(rpcDir, "aria2.conf");

	return { rpcHost, rpcPort, rpcSecret, rpcDir, rpcSession, rpcConf };
}

/**
 * Daemon options. The BitTorrent listener (peers and DHT) is pinned to
 * 6881–6889 so a firewall can name it; local peer discovery is off because the
 * daemon lives on a server, not a LAN. (`session=` is not an aria2 option —
 * input-file/save-session are — so it is not written.)
 */
export function buildAria2Config(config: Aria2RuntimeConfig): string {
	return `
# Aria2 RPC daemon for app
enable-rpc=true
rpc-listen-all=false
rpc-listen-port=${config.rpcPort}
dir=${config.rpcDir}
input-file=${config.rpcSession}
save-session=${config.rpcSession}
save-session-interval=60
max-concurrent-downloads=10
max-connection-per-server=16
min-split-size=1M
split=16
file-allocation=none
continue=true
seed-time=0
disk-cache=32M
listen-port=6881-6889
dht-listen-port=6881-6889
bt-enable-lpd=false
`.trim();
}

export function buildAria2LaunchConfig(config: Aria2RuntimeConfig): string {
	return `${buildAria2Config(config)}
rpc-secret=${config.rpcSecret}`;
}

export function buildAria2SpawnArgs(confPath: string): string[] {
	return [`--conf-path=${confPath}`];
}


export function getPublicAria2Error(error: unknown, locale: Locale = "zh"): string {
	if (error instanceof Error) {
		if (isMissingAria2BinaryError(error)) {
			return getMissingAria2BinaryMessage(locale);
		}
		if (error.message.includes("ARIA2_RPC_SECRET")) {
			return t("backend.aria2.rpcSecretMissing", locale);
		}
		if (error.message.includes("ARIA2_MANAGED_EXTERNALLY")) {
			return t("backend.aria2.managedDaemonUnreachable", locale);
		}
	}
	return t("backend.aria2.startFailed", locale);
}

/* ── Aria2 RPC Types ──────────────────────────────────────── */

export type Aria2Status = {
	followedBy?: string[];
	following?: string;
	belongsTo?: string;
	gid: string;
	status: "active" | "waiting" | "paused" | "error" | "complete" | "removed";
	totalLength: string;
	completedLength: string;
	uploadLength: string;
	downloadSpeed: string;
	uploadSpeed: string;
	connections: string;
	numSeeders: string;
	files: Array<{
		index: string;
		path: string;
		length: string;
		completedLength: string;
		selected: string;
		uris: Array<{ uri: string; status: string }>;
	}>;
	bittorrent?: {
		announceList: string[][];
		comment: string;
		info: { name: string };
	};
};

export type Aria2GlobalStat = {
	downloadSpeed: string;
	uploadSpeed: string;
	numActive: string;
	numWaiting: string;
	numStopped: string;
};

/* ── RPC Call ─────────────────────────────────────────────── */

async function rpcCall(method: string, params: unknown[] = []): Promise<unknown> {
	const config = getAria2RuntimeConfig();
	return postAria2Rpc({
		url: `http://${config.rpcHost}:${config.rpcPort}/jsonrpc`,
		method,
		params,
		secret: config.rpcSecret,
	});
}

/* ── Daemon Management ────────────────────────────────────── */

/**
 * True when the daemon is run by the host (the installer's confined
 * `<prefix>-aria2.service`, which denies private-network and metadata egress).
 * The application must then never spawn its own copy: it would run unconfined
 * inside the worker's cgroup and race the unit for the RPC port.
 */
export function isAria2ManagedExternally(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
	const value = env.ARIA2_MANAGED_EXTERNALLY?.trim().toLowerCase();
	return value === "1" || value === "true";
}

export const ARIA2_MANAGED_DAEMON_UNREACHABLE =
	"aria2 RPC is unreachable and ARIA2_MANAGED_EXTERNALLY forbids spawning a daemon; start the aria2 service";

// Linux can distinguish PID reuse even across a container or host restart.
async function launcherIdentity(pid: number) {
	if (process.platform !== "linux") return null;
	try {
		const [boot, info] = await Promise.all([readFile("/proc/sys/kernel/random/boot_id", "utf8"), readFile(`/proc/${pid}/stat`, "utf8")]);
		const startTicks = info.slice(info.lastIndexOf(")") + 2).split(" ")[19]; // field 22, after the parenthesized command name
		return startTicks && /^\d+$/.test(startTicks) ? boot.trim() + "_" + startTicks : null;
	} catch { return null; }
}

export async function reapAria2LaunchConfigs(directory: string) {
	const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return [];
		throw error;
	});
	for (const entry of entries) {
		const match = /^\.aria2\.launch\.([1-9]\d*)\.(?:([0-9a-f-]{36}_\d+)\.)?(?:\d+|[0-9a-f-]{36})\.conf$/.exec(entry.name);
		if (!match || !entry.isFile()) continue;
		const pid = Number(match[1]);
		const file = path.join(directory, entry.name);
		try {
			process.kill(pid, 0);
			if (match[2]) {
				const current = await launcherIdentity(pid);
				if (!current || current === match[2]) continue;
			} else {
				if (pid !== process.pid) continue;
				const info = await lstat(file);
				if (!info.isFile() || info.mtimeMs >= performance.timeOrigin - 1000) continue;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
		}
		await unlink(file).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
	}
}

export async function ensureAria2Daemon(): Promise<void> {
	if (!isAria2ManagedExternally()) await reapAria2LaunchConfigs(getAria2RuntimeConfig().rpcDir);
	// Always re-probe RPC health. A sticky daemonStarted flag would skip restart
	// after aria2c dies/OOM, leaving downloads permanently broken until process restart.
	try {
		await rpcCall("aria2.getVersion");

		return;
	} catch {
		// Not running — fall through to spawn
	}

	if (isAria2ManagedExternally()) {
		throw new Error(ARIA2_MANAGED_DAEMON_UNREACHABLE);
	}

	const config = getAria2RuntimeConfig();

	// Prepare session dir and conf
	await mkdir(config.rpcDir, { recursive: true, mode: 0o700 });

	// Create empty session file if not exists
	try { await readFile(config.rpcSession); } catch {
		// Session file does not exist yet — create an empty one.
		await writeFile(config.rpcSession, "");
	}

	const conf = buildAria2Config(config);

	await writeFile(config.rpcConf, conf, { mode: 0o600 });
	await chmod(config.rpcConf, 0o600).catch(() => undefined);

	// Resolve the aria2c binary without assuming a POSIX layout: PATH first,
	// then the platform's conventional install locations. `ARIA2_BIN` lets an
	// operator pin an explicit binary (e.g. a per-app Windows build).
	let aria2Bin: string | null = null;
	const override = process.env.ARIA2_BIN?.trim();
	if (override) {
		aria2Bin = await access(override, constants.X_OK).then(() => override).catch(() => null);
	} else {
		aria2Bin = await findExecutable("aria2c");
		if (!aria2Bin) {
			const fallbackDirs = IS_WINDOWS
				? [path.join(process.env.ProgramFiles ?? "C:\\Program Files", "aria2", "aria2c.exe")]
				: ["/usr/bin/aria2c", "/usr/local/bin/aria2c", "/opt/homebrew/bin/aria2c"];
			for (const candidate of fallbackDirs) {
				if (await access(candidate, constants.X_OK).then(() => true).catch(() => false)) {
					aria2Bin = candidate;
					break;
				}
			}
		}
	}
	if (!aria2Bin) {
		// Keep the historical error shape so isMissingAria2BinaryError() maps it
		// to the actionable "aria2c not installed" message.
		throw Object.assign(new Error("spawn aria2c ENOENT"), { code: "ENOENT" });
	}

	const owner = await launcherIdentity(process.pid);
	const launchConf = path.join(config.rpcDir, `.aria2.launch.${process.pid}.${owner ? owner + "." : ""}${randomUUID()}.conf`);
	try {
		await writeFile(launchConf, buildAria2LaunchConfig(config), { mode: 0o600, flag: "wx" });
		await chmod(launchConf, 0o600).catch(() => undefined);
		// Launch aria2c daemon. Keep the RPC secret out of the persisted config and argv.
		const proc = await spawnAria2Detached(buildAria2SpawnArgs(launchConf), aria2Bin);
		proc.unref();

		// Wait for RPC to become available
		for (let i = 0; i < 30; i++) {
			await new Promise((r) => setTimeout(r, 500));
			try {
				await rpcCall("aria2.getVersion");

				return;
			} catch {
				// Daemon not ready yet — retry after a short delay.
				continue;
			}
		}
		throw new Error("Aria2 RPC daemon failed to start within 15 seconds");
	} finally {
		await unlink(launchConf).catch(() => undefined);
	}
}

/* ── Download Operations ──────────────────────────────────── */

export async function addUri(
	uris: string[],
	options: Record<string, string> = {},
): Promise<string> {
	await ensureAria2Daemon();
	const gid = await rpcCall("aria2.addUri", [uris, options]);
	return gid as string;
}

export async function removeDownload(gid: string, force = false): Promise<string> {
	const method = force ? "aria2.forceRemove" : "aria2.remove";
	const result = await rpcCall(method, [gid]);
	return result as string;
}

/** Release both active transfers and the persistent stopped-result record. */
export async function forgetDownload(gid: string, visited = new Set<string>()) {
	if (visited.has(gid)) return;
	if (visited.size >= 8) throw new Error("Ambiguous aria2 download chain");
	visited.add(gid);
	try {
		const status = await tellStatus(gid);
		for (const child of [...(status.followedBy ?? []), ...[status.following, status.belongsTo].filter((id): id is string => Boolean(id))]) {
			if (!/^[a-f0-9]{16}$/i.test(child) || child === gid) throw new Error("Invalid aria2 content gid");
			await forgetDownload(child, visited);
		}
		if (["active", "waiting", "paused"].includes(status.status)) await removeDownload(gid, true);
		await rpcCall("aria2.removeDownloadResult", [gid]);
	} catch (error) {
		if (!(error instanceof Error && /GID .* is not found/i.test(error.message))) throw error;
	}
}

export async function pauseDownload(gid: string): Promise<string> {
	const result = await rpcCall("aria2.pause", [gid]);
	return result as string;
}

export async function unpauseDownload(gid: string): Promise<string> {
	const result = await rpcCall("aria2.unpause", [gid]);
	return result as string;
}

export async function tellStatus(gid: string, keys?: string[]): Promise<Aria2Status> {
	const result = await rpcCall("aria2.tellStatus", [gid, keys ?? []]);
	return result as Aria2Status;
}

export async function getGlobalStat(): Promise<Aria2GlobalStat> {
	const result = await rpcCall("aria2.getGlobalStat");
	return result as Aria2GlobalStat;
}

export async function changeOption(gid: string, options: Record<string, string>): Promise<string> {
	const result = await rpcCall("aria2.changeOption", [gid, options]);
	return result as string;
}

export async function changeGlobalOption(options: Record<string, string>): Promise<string> {
	const result = await rpcCall("aria2.changeGlobalOption", [options]);
	return result as string;
}

/* ── Progress Formatting Helpers ──────────────────────────── */

export function formatBytes(bytes: string | number): string {
	const n = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
	if (isNaN(n) || n === 0) return "0 B";
	return formatBytesShared(n);
}

export function formatSpeed(bytesPerSec: string | number): string {
	const n = typeof bytesPerSec === "string" ? parseInt(bytesPerSec, 10) : bytesPerSec;
	if (isNaN(n) || n === 0) return "0 B/s";
	return `${formatBytesShared(n)}/s`;
}

export function computeProgress(completed: string, total: string): number {
	const c = parseInt(completed, 10);
	const t = parseInt(total, 10);
	if (isNaN(c) || isNaN(t) || t === 0) return 0;
	return Math.min(100, Math.round((c / t) * 1000) / 10);
}
