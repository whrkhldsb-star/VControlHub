import { apiCopy } from "@/lib/i18n/api-copy";
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
import { execFile } from "child_process";
import net from "node:net";
import path, { posix } from "node:path";
import type { Prisma } from "@prisma/client";
import type { DockerTarget } from "./docker-cli";
import { isQuickServiceTargetConsistent, quickServiceEndpointFingerprint } from "./target-identity";
import { SSH_ENDPOINT_IDENTITY_SELECT } from "@/lib/ssh/server-connection-select";
import { realpathSync, rmSync } from "node:fs";
import { promisify } from "node:util";

import { writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { BusinessError, ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";
import { isValidTcpPort } from "@/lib/runtime/listen-port";
import type { ServiceTemplate } from "./types";
import { t } from "@/lib/i18n/service-translations";

const runFile = promisify(execFile);
const logger = createLogger("quick-service-internals");

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
		throw new ConflictError(apiCopy("apiCopy.service.is.busy.with.another.operation.please.retry.shortly.e2a3583e", { v0: String(normalizedSlug) }));
	}
	serviceOperationLocks.add(normalizedSlug);
	try {
		return await fn();
	} finally {
		serviceOperationLocks.delete(normalizedSlug);
	}
}

/** Test helper: drop any leftover per-process locks/reservations between cases. */
export function resetQuickServiceProcessStateForTests() {
	serviceOperationLocks.clear();
	// reservedPorts / portAllocChains are declared later in this module; call at runtime only.
	resetPortAllocationStateForTests();
}

/** Throws if the service is mid-install (the only state that should block other ops). */
export function assertServiceNotBusy(svc: { slug: string; status?: string | null }, operation: string) {
	if (svc.status === "installing") {
		throw new ConflictError(apiCopy("apiCopy.service.is.installing.cannot.please.retry.shortly.21843751", { v0: String(svc.slug), v1: String(operation) }));
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
/**
 * Under the allowed roots, the platform's own directories are still off limits
 * (A6-03): a third-party template could mount /opt/VControlHub read-write into
 * a container, and an uninstall with "delete data" would rm -rf it.
 */
const PROTECTED_HOST_PREFIXES = [
	...new Set([
		process.cwd(),
		"/opt/VControlHub",
		"/opt/vcontrolhub",
		"/srv/VControlHub",
		"/srv/vcontrolhub",
	].map((entry) => entry.replace(/\/+$/, ""))),
];

function isProtectedHostPath(hostPath: string) {
	return PROTECTED_HOST_PREFIXES.some((prefix) => prefix.startsWith("/") && (hostPath === prefix || hostPath.startsWith(`${prefix}/`) || prefix.startsWith(`${hostPath}/`)));
}

export function safeContainerName(slug: string): string {
	if (!SAFE_CONTAINER_RE.test(slug)) throw new ValidationError(t("backend.quick-service.serviceIdentifierIsInvalid"));
	return `qs-${slug}`;
}

export function assertTcpPort(port: number, label = "Port") {
	if (!isValidTcpPort(port)) {
		throw new ValidationError(apiCopy("apiCopy.is.invalid.please.use.a.port.in.the.range.1.65535.9d95d0ea", { v0: String(label), v1: String(port) }));
	}
}

export function assertImage(image: string) {
	if (!SAFE_IMAGE_RE.test(image)) throw new ValidationError(t("backend.quick-service.imageNameIsInvalid"));
}

function normalizeVolumeEndpoint(value: unknown, label: string) {
	// A template from a third-party source may carry any JSON shape here; a
	// non-string used to surface as a TypeError (internal error) instead of a
	// validation message.
	const trimmed = typeof value === "string" ? value.trim() : "";
	if (!trimmed.startsWith("/") || trimmed.includes("\0") || trimmed.includes("..")) {
		throw new ValidationError(apiCopy("apiCopy.path.is.invalid.fd173ea1", { v0: String(label) }));
	}
	return posix.normalize(trimmed).replace(/\/+$/, "") || "/";
}

function splitContainerPathAndOptions(raw: string) {
	const [containerPath, ...options] = raw.split(":");
	const normalizedPath = normalizeVolumeEndpoint(containerPath!, "Container mount");
	for (const option of options) {
		if (!SAFE_VOLUME_OPTION_RE.test(option)) throw new ValidationError(apiCopy("apiCopy.mount.option.is.invalid.4d595790", { v0: String(option) }));
	}
	return [normalizedPath, ...options].join(":");
}

function assertHostVolumeAllowed(hostPath: string, template: ServiceTemplate) {
	if (hostPath === DOCKER_SOCKET) {
		if (template.allowDockerSocket === true) return;
		throw new BusinessError(t("backend.quick-service.remoteApplicationsAreNotAllowedToMountThe"));
	}
	if (TRUSTED_HOST_MOUNTS.has(hostPath)) return;
	if (isProtectedHostPath(hostPath)) {
		throw new BusinessError(t("backend.quick-service.hostMountIsPlatformDirectory", { path: hostPath }));
	}
	if (!hostPath.includes(":") && HOST_VOLUME_ROOTS.some((root) => hostPath.startsWith(root))) return;
	throw new BusinessError(
		t("backend.quick-service.hostMountOutsideAllowedRoots", { path: hostPath }),
	);
}

function isRemovableHostVolume(hostPath: string) {
	if (hostPath === DOCKER_SOCKET || TRUSTED_HOST_MOUNTS.has(hostPath)) return false;
	if (hostPath === "/opt" || hostPath === "/srv") return false;
	if (isProtectedHostPath(hostPath)) return false;
	return HOST_VOLUME_ROOTS.some((root) => hostPath.startsWith(root));
}

function hostVolumePaths(rawVolumesJson: string) {
	const volumes: unknown = JSON.parse(rawVolumesJson);
	if (!Array.isArray(volumes)) throw new ValidationError(t("backend.quickService.unreadableVolumes"));
	return volumes.map((volume: { host: unknown }) => normalizeVolumeEndpoint(volume?.host, "Host mount"));
}

export function getRemovableHostVolumes(rawVolumesJson: string) {
	return [...new Set(hostVolumePaths(rawVolumesJson).filter(isRemovableHostVolume))];
}

// Docker bind mounts follow links in host paths. Resolve existing ancestors
// even when a service has not created its final data directory yet.
function physicalHostPath(host: string): string {
	try {
		return realpathSync.native(host);
	} catch (error) {
		const parent = path.dirname(host);
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === host) throw error;
		return path.join(physicalHostPath(parent), path.basename(host));
	}
}

function containsPath(parent: string, child: string) {
	const relative = path.relative(parent, child);
	return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

export async function assertExclusiveHostVolumes(
	serviceId: string,
	paths: string[],
	db: Pick<Prisma.TransactionClient, "quickService"> = prisma,
) {
	if (!paths.length) return;
	const candidates = paths.map(host => ({ host, physical: physicalHostPath(host) }));
	for (const { host, physical } of candidates) {
		if (process.platform !== "win32" && !isRemovableHostVolume(physical)) {
			throw new ConflictError(t("backend.quick-service.hostMountOutsideAllowedRoots", { path: host }));
		}
	}
	const others = await db.quickService.findMany({ where: { id: { not: serviceId }, OR: [{ instanceKey: "hub-host" }, { serverId: null }] }, select: { volumesJson: true } });
	for (const other of others) {
		for (const host of hostVolumePaths(other.volumesJson)) {
			const physical = physicalHostPath(host);
			const overlap = candidates.find(candidate => containsPath(physical, candidate.physical) || containsPath(candidate.physical, physical)
				|| containsPath(host, candidate.host) || containsPath(candidate.host, host));
			if (overlap) throw new ConflictError(t("backend.quickService.volumeInUse", { path: overlap.host }));
		}
	}
}

export async function removeExclusiveHostVolumes(serviceId: string, paths: string[]) {
	if (!paths.length) return;
	await prisma.$transaction(async (tx) => {
		// Protect the last reference check and removal against concurrent inserts
		// and volume changes, including those from another worker.
		await tx.$executeRaw`LOCK TABLE "quick_services" IN SHARE MODE`;
		await assertExclusiveHostVolumes(serviceId, paths, tx);
		for (const path of paths) rmSync(path, { recursive: true, force: true });
	});
}

export function validateTemplate(template: ServiceTemplate) {
	safeContainerName(template.slug);
	assertImage(template.image);
	assertTcpPort(template.defaultPort, "Default port");
	if (template.internalPort !== undefined) assertTcpPort(template.internalPort, "Container port");
	for (const ep of template.extraPorts ?? []) {
		assertTcpPort(ep.host, "Extra port");
		assertTcpPort(ep.container, "Extra container port");
	}
	for (const key of Object.keys(template.envJson)) {
		if (!SAFE_ENV_KEY_RE.test(key)) throw new ValidationError(apiCopy("apiCopy.environment.variable.name.is.invalid.fb97e0f0", { v0: String(key) }));
	}
	for (const vol of template.volumesJson) {
		const host = normalizeVolumeEndpoint(vol.host, "Host mount");
		assertHostVolumeAllowed(host, template);
		splitContainerPathAndOptions(vol.container);
	}
}

export function parseCommandArgs(command?: string): string[] {
	if (!command?.trim()) return [];
	const args: string[] = [];
	let current = "";
	let started = false;
	let quote: "'" | '"' | null = null;
	let escaping = false;
	for (const ch of command) {
		if (!/\s/.test(ch)) started = true;
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
			if (started) {
				started = false;
				args.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (escaping || quote) throw new ValidationError(t("backend.quick-service.startupCommandFormatIsInvalid"));
	if (started) args.push(current);
	return args;
}

/** Re-exports of the host-path helpers used by the lifecycle module. */
export const __internals = {
	normalizeVolumeEndpoint,
	splitContainerPathAndOptions,
	TRUSTED_HOST_MOUNTS,
	DOCKER_SOCKET,
};

/* -- Audit writer ------------------------------------------------------- */

export type QuickServiceDiff = {
	before?: Record<string, unknown> | null;
	after?: Record<string, unknown> | null;
};

export type QuickServiceSnapshot = NonNullable<Awaited<ReturnType<typeof readQuickServiceSnapshot>>>;

/**
 * What an audit entry may keep of a service's configuration: the environment is stored with its generated
 * administrator passwords and tokens (MinIO, n8n, Pi-hole, code-server ...), and every start, stop, refresh and
 * uninstall copied the whole of it into audit_logs, which are viewed, exported, backed up and kept. Only the names
 * of the variables are kept.
 */
export function redactSnapshotForAudit(snapshot: Record<string, unknown> | null | undefined): Record<string, unknown> | null | undefined {
	if (!snapshot || typeof snapshot.envJson !== "string") return snapshot;
	let names: string[] = [];
	try {
		const parsed: unknown = JSON.parse(snapshot.envJson);
		if (parsed && typeof parsed === "object") names = Object.keys(parsed as Record<string, unknown>);
	} catch { /* unreadable: nothing to name */ }
	return { ...snapshot, envJson: JSON.stringify(Object.fromEntries(names.map((name) => [name, "***"]))) };
}

export async function writeQuickServiceAudit(input: {
	/** The server the service runs on (its id), or the hub host: the entry belongs to that server's customer. */
	instanceKey?: string;
	target?: DockerTarget;
	userId?: string | null;
	action: "install" | "start" | "stop" | "sync" | "update" | "uninstall";
	slug: string;
	status: "started" | "succeeded" | "failed";
	detail?: Record<string, string | number | boolean | null>;
	diff?: QuickServiceDiff | null;
}) {
	try {
		type PrismaJsonValue = string | number | boolean | null | { [key: string]: PrismaJsonValue } | PrismaJsonValue[];
		const detail: Record<string, PrismaJsonValue> = {
			slug: input.slug,
			...input.detail,
		};
		if (input.diff && (input.diff.before || input.diff.after)) {
			detail.diff = { before: redactSnapshotForAudit(input.diff.before), after: redactSnapshotForAudit(input.diff.after) } as unknown as PrismaJsonValue;
		}
		// The customer's own audit page lists entries by team; these used to carry none, so only the platform saw them.
		const teamId = input.target?.kind === "remote" ? input.target.expectedTeamId
			: input.instanceKey && input.instanceKey !== "hub-host"
			? (await prisma.server.findUnique({ where: { id: input.instanceKey }, select: { teamId: true } }))?.teamId ?? null
			: undefined;
		await writeAuditLog({
			actorType: input.userId ? "USER" : "SYSTEM",
			actorId: input.userId ?? undefined,
			action: `quick_service.${input.action}.${input.status}`,
			severity: input.status === "failed" ? "WARNING" : "INFO",
			detail,
			...(teamId !== undefined ? { teamId } : {}),
		});
	} catch {
		// Audit log failures must not flip an otherwise successful operation
		// into a perceived failure. The lifecycle module's primary return
		// value (the prisma row or thrown error) is the source of truth.
	}
}

/**
 * Snapshot the lifecycle-relevant columns of a quick service row so the
 * audit log can render a real "before/after" diff. Returns null for new
 * slugs that have never been installed.
 */
export async function readQuickServiceSnapshot(slug: string, instanceKey: string, target?: DockerTarget) {
	const row = await prisma.quickService.findUnique({
		where: { instanceKey_slug: { instanceKey, slug } },
		select: {
			id: true, slug: true, instanceKey: true, serverId: true,
			server: target?.kind === "remote" ? { select: { teamId: true, ...SSH_ENDPOINT_IDENTITY_SELECT } } : false,
			status: true, port: true, containerId: true, image: true, path: true, internalPort: true,
			extraPortsJson: true, command: true, envJson: true, volumesJson: true, error: true,
		},
	});
	if (!row) return null;
	if (row.slug !== slug || row.instanceKey !== instanceKey || !isQuickServiceTargetConsistent(instanceKey, row.serverId)) {
		throw new ForbiddenError(t("backend.quickService.targetMismatch"));
	}
	const { server, ...snapshot } = row;
	if (target?.kind === "remote" && target.expectedTeamId !== undefined && (!server || target.expectedTeamId !== server.teamId ||
		(target.endpoint && quickServiceEndpointFingerprint(target.endpoint) !== quickServiceEndpointFingerprint(server)))) {
		throw new ForbiddenError(t("backend.command.connectionChanged"));
	}
	return snapshot;
}

export async function captureQuickServiceSnapshot(slug: string, instanceKey: string = "hub-host", target?: DockerTarget) {
	try {
		return await readQuickServiceSnapshot(slug, instanceKey, target);
	} catch {
		// A missing audit diff does not prevent a lifecycle operation. Installs
		// need the actual rollback state and use the strict reader directly.
		return null;
	}
}

/* -- Port allocation & detection --------------------------------------- */

const PORT_RANGE_MIN = 10000;
const PORT_RANGE_MAX = 65535;
const PORT_MAX_ATTEMPTS = 50;

/**
 * In-process port leases held from allocate/assert until docker -p binds
 * (or install aborts). Combined with the isPortAvailable OS probe this closes
 * the common concurrent-install TOCTOU on a single Node process.
 */
const probeOwner = Symbol("port probe");
const reservedPorts = new Map<number, symbol>();

export function releasePortReservation(port: number, owner = probeOwner): void {
	if (reservedPorts.get(port) === owner) reservedPorts.delete(port);
}

export function releasePortReservations(ports: Iterable<number>, owner = probeOwner): void {
	for (const port of ports) releasePortReservation(port, owner);
}

export function templateReservedPorts(template: ServiceTemplate, hostPort: number): number[] {
	const ports = [hostPort, ...(template.extraPorts ?? []).map(ep => ep.host)];
	if (new Set(ports).size !== ports.length) throw new ConflictError(t("backend.quick-service.portInUseOnTarget", { port: ports.find((p, i) => ports.indexOf(p) !== i)! }));
	return ports;
}

/**
 * Probe whether a TCP port is free on the hub host by binding it in-process
 * with net.createServer. The previous implementation spawned a `node -e`
 * child per probe, which blocked the event loop (execFileSync) and paid a
 * full process startup per port. Errors (EADDRINUSE, EACCES, ...) resolve
 * false — same swallow semantics as the child probe.
 */
export async function isPortAvailable(port: number): Promise<boolean> {
	assertTcpPort(port);
	if (reservedPorts.has(port)) return false;
	return await new Promise<boolean>((resolve) => {
		const server = net.createServer();
		server.once("error", () => resolve(false));
		server.listen(port, "0.0.0.0", () => {
			server.close(() => resolve(true));
		});
	});
}

/** Probe free + mark reserved until releasePortReservation. */
export async function reservePort(port: number, owner = probeOwner): Promise<boolean> {
	assertTcpPort(port);
	if (reservedPorts.has(port)) return false;
	if (!(await isPortAvailable(port))) return false;
	if (reservedPorts.has(port)) return false;
	reservedPorts.set(port, owner);
	return true;
}

export async function allocatePort(preferredPort?: number, owner = probeOwner): Promise<number> {
	if (preferredPort) {
		assertTcpPort(preferredPort);
		if (await reservePort(preferredPort, owner)) return preferredPort;
	}
	const tried = new Set<number>();
	for (let i = 0; i < PORT_MAX_ATTEMPTS; i++) {
		const port = PORT_RANGE_MIN + Math.floor(Math.random() * (PORT_RANGE_MAX - PORT_RANGE_MIN + 1));
		if (tried.has(port)) continue;
		tried.add(port);
		if (await reservePort(port, owner)) return port;
	}
	throw new BusinessError(t("backend.quick-service.unableToAllocateAnAvailablePortPleaseSpecify"));
}

/**
 * Hub-host listening-port inventory. `ss(8)` only exists on Linux; on any
 * other platform the probe fails and we return an empty list — warn once per
 * process so operators notice the blind spot without per-request log spam.
 */
let warnedNonLinuxPortInventory = false;

export async function getUsedPorts(): Promise<number[]> {
	try {
		const out = await readListeningSockets();
		return Array.from(parseListeningPorts(out)).sort((a, b) => a - b);
	} catch {
		if (process.platform !== "linux" && !warnedNonLinuxPortInventory) {
			warnedNonLinuxPortInventory = true;
			logger.warn(
				"`ss` listening-port inventory is unavailable on this platform; hub-host used-port list returns empty",
				{ platform: process.platform },
			);
		}
		return [];
	}
}

export async function readListeningSockets(): Promise<string> {
	try {
		const { stdout } = await runFile("ss", ["-tlnpH"], { timeout: 5000, encoding: "utf8" });
		return String(stdout);
	} catch {
		const { stdout } = await runFile("ss", ["-tlnp"], { timeout: 5000, encoding: "utf8" });
		return String(stdout);
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
		if (isValidTcpPort(port)) ports.add(port);
	}
	return ports;
}

/**
 * Local hub only: probe and reserve host + template extra ports until docker binds.
 * Callers for remote targets must skip this and probe the VPS instead.
 */
export async function assertTemplatePortsAvailable(template: ServiceTemplate, hostPort: number, owner: symbol) {
	const ports = templateReservedPorts(template, hostPort);
	try {
		for (const port of ports) {
			if (reservedPorts.get(port) === owner) continue;
			if (!(await reservePort(port, owner))) {
				const key = port === hostPort ? "apiCopy.port.is.already.in.use.please.use.a.different.port.and.retry.fd0f30e2"
					: "apiCopy.extra.port.is.already.in.use.please.use.a.different.port.and.ret.73defe8c";
				throw new ConflictError(apiCopy(key, { v0: String(port) }));
			}
		}
	} catch (err) {
		releasePortReservations(ports, owner);
		throw err;
	}
}

/** Serialize local port allocation across concurrent install calls in-process. */
const portAllocChains = new Map<string, Promise<unknown>>();

export async function withPortAllocationLock<T>(scope: string, fn: () => Promise<T>): Promise<T> {
	const prev = portAllocChains.get(scope) ?? Promise.resolve();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const chained = prev.catch(() => undefined).then(() => gate);
	portAllocChains.set(scope, chained);
	await prev.catch(() => undefined);
	try {
		return await fn();
	} finally {
		release();
		if (portAllocChains.get(scope) === chained) portAllocChains.delete(scope);
	}
}

function resetPortAllocationStateForTests() {
	reservedPorts.clear();
	portAllocChains.clear();
}
