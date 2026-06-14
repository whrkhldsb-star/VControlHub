/**
 * Service-internal helpers shared by every quick-service code path. The
 * previous `lib/quick-service/service.ts` god-file bundled these private
 * utilities (mutex lock, safety regexes, port probing, audit writer) with
 * the public lifecycle API. Extracting them lets the lifecycle module stay
 * focused on the install/start/stop/update/sync verbs while the helpers
 * stay unit-testable in isolation.
 *
 * Exports intentionally mirror the previous surface so the lifecycle
 * module and the rest of the codebase continue to import these helpers
 * from `./service-internals` directly without behaviour changes.
 */
import { execFileSync } from "child_process";
import { mkdirSync, rmSync } from "node:fs";

import { writeAuditLog } from "@/lib/audit/service";
import type { ServiceTemplate } from "./types";

/* -- Concurrency / state guards ----------------------------------------- */

const serviceOperationLocks = new Set<string>();

/**
 * Serialise per-slug mutations: only one operation may run against a given
 * service at a time. Re-entrant calls throw immediately so the UI can
 * surface a friendly error instead of silently queuing.
 */
export async function withServiceOperationLock<T>(
	slug: string,
	_operation: string,
	fn: () => Promise<T>,
): Promise<T> {
	const normalizedSlug = slug.trim();
	if (serviceOperationLocks.has(normalizedSlug)) {
		throw new Error(`服务 ${normalizedSlug} 正在执行其它操作，请稍后重试`);
	}
	serviceOperationLocks.add(normalizedSlug);
	try {
		return await fn();
	} finally {
		serviceOperationLocks.delete(normalizedSlug);
	}
}

/** Throws if the service is mid-install (the only state that should block other ops). */
export function assertServiceNotBusy(svc: { slug: string; status?: string | null }, operation: string) {
	if (svc.status === "installing") {
		throw new Error(`服务 ${svc.slug} 正在安装中，无法${operation}，请稍后重试`);
	}
}

/* -- Safety regexes ----------------------------------------------------- */

const SAFE_CONTAINER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const SAFE_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_IMAGE_RE = /^(?:[a-z0-9]+(?:(?:[._-]|__|[-]*)[a-z0-9]+)*(?::[0-9]+)?\/)?[a-z0-9]+(?:(?:[._-]|__|[-]*)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._-]|__|[-]*)[a-z0-9]+)*)*(?::[A-Za-z0-9_.-]{1,128}|@[A-Za-z0-9_+.-]+:[A-Fa-f0-9=:]+)?$/;
const SAFE_VOLUME_OPTION_RE = /^(?:ro|rw|z|Z|cached|delegated|consistent|rshared|rslave|rprivate|shared|slave|private)$/;
const HOST_VOLUME_ROOTS = ["/opt/", "/srv/"];
const TRUSTED_HOST_MOUNTS = new Set(["/etc/timezone", "/etc/localtime"]);
const DOCKER_SOCKET = "/var/run/docker.sock";

export function safeContainerName(slug: string): string {
	if (!SAFE_CONTAINER_RE.test(slug)) throw new Error("服务标识无效");
	return `qs-${slug}`;
}

export function assertTcpPort(port: number, label = "端口") {
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`${label} ${port} 无效，请使用 1-65535 范围内的端口。`);
	}
}

export function assertImage(image: string) {
	if (!SAFE_IMAGE_RE.test(image)) throw new Error("镜像名称无效");
}

function normalizeVolumeEndpoint(value: string, label: string) {
	const trimmed = value.trim();
	if (!trimmed.startsWith("/") || trimmed.includes("\0") || trimmed.includes("..")) {
		throw new Error(`${label} 路径无效`);
	}
	return trimmed.replace(/\/+$/, "") || "/";
}

function splitContainerPathAndOptions(raw: string) {
	const [containerPath, ...options] = raw.split(":");
	const normalizedPath = normalizeVolumeEndpoint(containerPath!, "容器挂载");
	for (const option of options) {
		if (!SAFE_VOLUME_OPTION_RE.test(option)) throw new Error(`挂载选项 ${option} 无效`);
	}
	return [normalizedPath, ...options].join(":");
}

function assertHostVolumeAllowed(hostPath: string, template: ServiceTemplate) {
	if (hostPath === DOCKER_SOCKET) {
		if (template.allowDockerSocket === true) return;
		throw new Error("远程应用不允许挂载 Docker socket");
	}
	if (TRUSTED_HOST_MOUNTS.has(hostPath)) return;
	if (HOST_VOLUME_ROOTS.some((root) => hostPath === root.slice(0, -1) || hostPath.startsWith(root))) return;
	throw new Error(`宿主机挂载路径 ${hostPath} 不在允许范围内`);
}

function isRemovableHostVolume(hostPath: string) {
	if (hostPath === DOCKER_SOCKET || TRUSTED_HOST_MOUNTS.has(hostPath)) return false;
	if (hostPath === "/opt" || hostPath === "/srv") return false;
	return HOST_VOLUME_ROOTS.some((root) => hostPath.startsWith(root));
}

export function getRemovableHostVolumes(rawVolumesJson: string | null | undefined) {
	let volumes: Array<{ host?: unknown }> = [];
	try {
		const parsed = JSON.parse(rawVolumesJson || "[]");
		if (Array.isArray(parsed)) volumes = parsed;
	} catch {
		return [];
	}
	const paths = new Set<string>();
	for (const vol of volumes) {
		if (typeof vol.host !== "string") continue;
		const host = normalizeVolumeEndpoint(vol.host, "宿主机挂载");
		if (isRemovableHostVolume(host)) paths.add(host);
	}
	return [...paths];
}

export function validateTemplate(template: ServiceTemplate) {
	safeContainerName(template.slug);
	assertImage(template.image);
	assertTcpPort(template.defaultPort, "默认端口");
	if (template.internalPort !== undefined) assertTcpPort(template.internalPort, "容器端口");
	for (const ep of template.extraPorts ?? []) {
		assertTcpPort(ep.host, "额外端口");
		assertTcpPort(ep.container, "额外容器端口");
	}
	for (const key of Object.keys(template.envJson)) {
		if (!SAFE_ENV_KEY_RE.test(key)) throw new Error(`环境变量名 ${key} 无效`);
	}
	for (const vol of template.volumesJson) {
		const host = normalizeVolumeEndpoint(vol.host, "宿主机挂载");
		assertHostVolumeAllowed(host, template);
		splitContainerPathAndOptions(vol.container);
	}
}

export function parseCommandArgs(command?: string): string[] {
	if (!command?.trim()) return [];
	const args: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaping = false;
	for (const ch of command) {
		if (escaping) {
			current += ch;
			escaping = false;
			continue;
		}
		if (ch === "\\") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (ch === quote) quote = null;
			else current += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (current) {
				args.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (escaping || quote) throw new Error("启动命令格式无效");
	if (current) args.push(current);
	return args;
}

export function resolveEnvValue(value: string) {
	return value === "127.0.0.1" || value === "localhost" ? "host.docker.internal" : value;
}

/** Re-exports of the host-path helpers used by the lifecycle module. */
export const __internals = {
	normalizeVolumeEndpoint,
	splitContainerPathAndOptions,
	mkdirSync,
	rmSync,
	TRUSTED_HOST_MOUNTS,
	DOCKER_SOCKET,
};

/* -- Audit writer ------------------------------------------------------- */

export async function writeQuickServiceAudit(input: {
	userId?: string | null;
	action: "install" | "start" | "stop" | "sync" | "update" | "uninstall";
	slug: string;
	status: "started" | "succeeded" | "failed";
	detail?: Record<string, string | number | boolean | null>;
}) {
	try {
		await writeAuditLog({
			actorType: input.userId ? "USER" : "SYSTEM",
			actorId: input.userId ?? undefined,
			action: `quick_service.${input.action}.${input.status}`,
			severity: input.status === "failed" ? "WARNING" : "INFO",
			detail: {
				slug: input.slug,
				...input.detail,
			},
		});
	} catch {
		// Audit log failures must not flip an otherwise successful operation
		// into a perceived failure. The lifecycle module's primary return
		// value (the prisma row or thrown error) is the source of truth.
	}
}

/* -- Port allocation & detection --------------------------------------- */

const PORT_RANGE_MIN = 10000;
const PORT_RANGE_MAX = 65535;
const PORT_MAX_ATTEMPTS = 50;

export function isPortAvailableSync(port: number): boolean {
	assertTcpPort(port);
	try {
		execFileSync(
			"node",
			[
				"-e",
				"const n=require('net');const p=Number(process.argv[1]);const s=n.createServer();s.on('error',()=>process.exit(1));s.listen(p,'0.0.0.0',()=>s.close(()=>process.exit(0)))",
				String(port),
			],
			{ timeout: 5000 },
		);
		return true;
	} catch {
		return false;
	}
}

export function allocatePort(preferredPort?: number): number {
	if (preferredPort) {
		assertTcpPort(preferredPort);
		if (isPortAvailableSync(preferredPort)) return preferredPort;
	}
	const tried = new Set<number>();
	for (let i = 0; i < PORT_MAX_ATTEMPTS; i++) {
		const port = PORT_RANGE_MIN + Math.floor(Math.random() * (PORT_RANGE_MAX - PORT_RANGE_MIN + 1));
		if (tried.has(port)) continue;
		tried.add(port);
		if (isPortAvailableSync(port)) return port;
	}
	throw new Error("无法分配可用端口，请手动指定端口后重试");
}

export function getUsedPorts(): number[] {
	try {
		const out = readListeningSockets();
		return Array.from(parseListeningPorts(out)).sort((a, b) => a - b);
	} catch {
		return [];
	}
}

export function readListeningSockets(): string {
	try {
		return execFileSync("ss", ["-tlnpH"], { timeout: 5000, encoding: "utf8" });
	} catch {
		return execFileSync("ss", ["-tlnp"], { timeout: 5000, encoding: "utf8" });
	}
}

export function findPortLine(output: string, port: number): string | null {
	for (const line of output.split("\n")) {
		const ports = parseListeningPorts(line);
		if (ports.has(port)) return line;
	}
	return null;
}

export function parseListeningPorts(output: string): Set<number> {
	const ports = new Set<number>();
	for (const line of output.split("\n")) {
		const match = line.match(/(?:^|\s)(?:\[.*?\]|[^\s:]+):(\d+)\b/);
		if (!match) continue;
		const port = Number(match[1]);
		if (Number.isInteger(port) && port >= 1 && port <= 65535) ports.add(port);
	}
	return ports;
}

export function assertPortAvailable(port: number, label = "端口") {
	assertTcpPort(port, label);
	if (!isPortAvailableSync(port)) {
		throw new Error(`${label} ${port} 已被占用，请更换端口后重试。`);
	}
}

export function assertTemplatePortsAvailable(template: ServiceTemplate, hostPort: number) {
	assertPortAvailable(hostPort, "端口");
	for (const ep of template.extraPorts ?? []) {
		assertPortAvailable(ep.host, "额外端口");
	}
}
