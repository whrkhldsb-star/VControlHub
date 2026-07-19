import { writeFile, readFile, mkdir, unlink, chmod } from "fs/promises";
import { access, constants } from "fs/promises";
import path from "path";
import { getAppSlug } from "@/lib/branding";
import {
  getMissingAria2BinaryMessage,
  isMissingAria2BinaryError,
  spawnAria2Detached,
} from "@/lib/aria2/command-runner";
import { postAria2Rpc } from "@/lib/aria2/provider-http";
import { t, type Locale } from "@/lib/i18n/translations";

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
	const rpcHost = env.ARIA2_RPC_HOST?.trim() || "127.0.0.1";
	const rpcPortText = env.ARIA2_RPC_PORT?.trim() || String(DEFAULT_RPC_PORT);
	const rpcPort = Number(rpcPortText);

	if (!Number.isInteger(rpcPort) || rpcPort < 1 || rpcPort > 65535) {
		throw new Error("ARIA2_RPC_PORT must be a valid TCP port");
	}

	const appSlug = getAppSlug(env as NodeJS.ProcessEnv);
	const defaultRpcSecret = [appSlug, "default", "token"].join("_");
	const rpcSecret = env.ARIA2_RPC_SECRET?.trim() || defaultRpcSecret;
	if (env.NODE_ENV === "production" && !env.ARIA2_RPC_SECRET?.trim()) {
		throw new Error("ARIA2_RPC_SECRET is required in production");
	}
	if (env.NODE_ENV === "production" && /(^|_)default_token$/.test(rpcSecret)) {
		throw new Error("ARIA2_RPC_SECRET must not use the default token in production");
	}

	const appDir = env.APP_DIR?.trim() || process.cwd();
	const rpcDir = env.ARIA2_RPC_DIR?.trim() || path.join(appDir, "tmp", "aria2");
	const rpcSession = path.join(rpcDir, "aria2.session");
	const rpcConf = path.join(rpcDir, "aria2.conf");

	return { rpcHost, rpcPort, rpcSecret, rpcDir, rpcSession, rpcConf };
}

export function buildAria2Config(config: Aria2RuntimeConfig): string {
	return `
# Aria2 RPC daemon for app
enable-rpc=true
rpc-listen-all=false
rpc-listen-port=${config.rpcPort}
dir=${config.rpcDir}
session=${config.rpcSession}
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
	}
	return t("backend.aria2.startFailed", locale);
}

/* ── Aria2 RPC Types ──────────────────────────────────────── */

export type Aria2Status = {
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

let daemonStarted = false;

export async function ensureAria2Daemon(): Promise<void> {
	if (daemonStarted) return;

	try {
		// Check if already running
		await rpcCall("aria2.getVersion");
		daemonStarted = true;
		return;
	} catch {
		// Not running, start it
	}

	const config = getAria2RuntimeConfig();

	// Prepare session dir and conf
	await mkdir(config.rpcDir, { recursive: true });

	// Create empty session file if not exists
	try { await readFile(config.rpcSession); } catch {
		// Session file does not exist yet — create an empty one.
		await writeFile(config.rpcSession, "");
	}

	const conf = buildAria2Config(config);

	await writeFile(config.rpcConf, conf, { mode: 0o600 });
	await chmod(config.rpcConf, 0o600).catch(() => undefined);

	const launchConf = path.join(config.rpcDir, `.aria2.launch.${process.pid}.${Date.now()}.conf`);
	await writeFile(launchConf, buildAria2LaunchConfig(config), { mode: 0o600 });
	await chmod(launchConf, 0o600).catch(() => undefined);

	try {
		await access("/usr/bin/aria2c", constants.X_OK);
	} catch (error) {
		try {
			await access("/usr/local/bin/aria2c", constants.X_OK);
		} catch {
			// aria2c not found in either standard location — re-throw the original error.
			throw Object.assign(new Error("spawn aria2c ENOENT"), { code: "ENOENT", cause: error });
		}
	}

	try {
		// Launch aria2c daemon. Keep the RPC secret out of the persisted config and argv.
		const proc = spawnAria2Detached(buildAria2SpawnArgs(launchConf));
		proc.unref();

		// Wait for RPC to become available
		for (let i = 0; i < 30; i++) {
			await new Promise((r) => setTimeout(r, 500));
			try {
				await rpcCall("aria2.getVersion");
				daemonStarted = true;
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

export async function addTorrent(
	torrent: string,	// base64 encoded
	ouris: string[] = [],
	options: Record<string, string> = {},
): Promise<string> {
	await ensureAria2Daemon();
	const gid = await rpcCall("aria2.addTorrent", [torrent, ouris, options]);
	return gid as string;
}

export async function removeDownload(gid: string, force = false): Promise<string> {
	const method = force ? "aria2.forceRemove" : "aria2.remove";
	const result = await rpcCall(method, [gid]);
	return result as string;
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

export async function tellActive(keys?: string[]): Promise<Aria2Status[]> {
	const result = await rpcCall("aria2.tellActive", [keys ?? []]);
	return result as Aria2Status[];
}

export async function tellWaiting(offset = 0, num = 100, keys?: string[]): Promise<Aria2Status[]> {
	const result = await rpcCall("aria2.tellWaiting", [offset, num, keys ?? []]);
	return result as Aria2Status[];
}

export async function tellStopped(offset = 0, num = 100, keys?: string[]): Promise<Aria2Status[]> {
	const result = await rpcCall("aria2.tellStopped", [offset, num, keys ?? []]);
	return result as Aria2Status[];
}

export async function getGlobalStat(): Promise<Aria2GlobalStat> {
	const result = await rpcCall("aria2.getGlobalStat");
	return result as Aria2GlobalStat;
}

export async function purgeDownloadResult(): Promise<string> {
	const result = await rpcCall("aria2.purgeDownloadResult");
	return result as string;
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
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(n) / Math.log(1024));
	return `${(n / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: string | number): string {
	const n = typeof bytesPerSec === "string" ? parseInt(bytesPerSec, 10) : bytesPerSec;
	if (isNaN(n) || n === 0) return "0 B/s";
	const units = ["B/s", "KB/s", "MB/s", "GB/s"];
	const i = Math.floor(Math.log(n) / Math.log(1024));
	return `${(n / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function computeProgress(completed: string, total: string): number {
	const c = parseInt(completed, 10);
	const t = parseInt(total, 10);
	if (isNaN(c) || isNaN(t) || t === 0) return 0;
	return Math.min(100, Math.round((c / t) * 1000) / 10);
}
