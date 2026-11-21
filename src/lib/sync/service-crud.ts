import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Sync service — DB CRUD (R28 god-file split).
 *
 * Pure prisma operations for `SyncJob`. The execution / orchestration
 * lives in `./service-runtime`; the command strings it produces live in
 * `./service-commands`.
 */
import type { Prisma } from "@prisma/client";
import posixPath from "node:path/posix";

import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { prisma } from "@/lib/db";
import { getPermissionsFromRoles, type Permission } from "@/lib/auth/rbac";
import { serverTeamWhere, syncJobTeamWhere, teamCreateData } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertNotRecycled } from "@/lib/storage/archive-access";
import { resolveStorageRemotePath } from "@/lib/storage/remote-containment";
import { STORAGE_SSH_SERVER_SELECT, resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { storageNodeTeamWhere } from "@/lib/auth/team-scope";
import { expandStorageBasePath, normalizeStorageTargetDirectory } from "@/lib/storage/path-utils";
import { syncEndpointAccess, effectiveDeleteOrphans, isProtectedDeleteTarget, syncEndpointsOverlap } from "./bidirectional";
import { t } from "@/lib/i18n/service-translations";

/** The caller's scope and, when known, its effective permissions (an identity template or API token may grant fewer than its roles). */
export type SyncSessionScope = Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> & { permissions?: Permission[] };

export type SyncJobInput = {
	name: string;
	sourceServerId: string;
	sourcePath: string;
	targetServerId: string;
	targetPath: string;
	syncType?: "MIRROR" | "BACKUP" | "INCREMENTAL" | "BIDIRECTIONAL";
	schedule?: string;
	deleteOrphans?: boolean;
	compress?: boolean;
	createdBy?: string;
	session?: SyncSessionScope;
};

const serverSummary = { select: { id: true, name: true, host: true } } as const;

export function assertDisjointSyncEndpoints(input: Pick<SyncJobInput, "sourceServerId" | "targetServerId" | "sourcePath" | "targetPath">) {
	if (syncEndpointsOverlap(input)) {
		throw new ValidationError(t("backend.sync.sourceAndTargetEndpointsMustDiffer"));
	}
}

/**
 * Ensure source/target servers are visible under the caller's teamWhere.
 * Prevents storage:write users from stamping foreign VPS into a SyncJob
 * (and later rsyncing their files) after Server list/CRUD became team-scoped.
 */
async function assertSyncServersInScope(
	serverIds: string[],
	session?: SyncSessionScope | null,
): Promise<void> {
	const unique = Array.from(new Set(serverIds.filter(Boolean)));
	if (unique.length === 0) {
		throw new ValidationError(t("backend.sync.sourceAndTargetServersAreRequired"));
	}
	const scope = session ? serverTeamWhere(session, "connect") : {};
	const servers = await prisma.server.findMany({
		where: { id: { in: unique }, ...scope },
		select: { id: true },
	});
	if (servers.length !== unique.length) {
		throw new ValidationError(
			apiCopy("apiCopy.one.or.more.source.target.servers.were.not.found.or.are.outside..cf44bdaa"),
		);
	}
}

/** Whether `path` (absolute) is `root` or lies below it; a relative path is resolved by the SSH user's shell, so it is never provably inside. */
export function syncPathWithinRoot(path: string, root: string): boolean {
	if (!path.startsWith("/")) return false;
	const normalizedRoot = posixPath.normalize(root).replace(/\/+$/, "") || "/";
	const normalizedPath = posixPath.normalize(path).replace(/\/+$/, "") || "/";
	if (normalizedRoot === "/") return true;
	return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

/**
 * A sync job reads and writes as the server's SSH user, anywhere on the machine — the reach of a terminal. A caller
 * who may not open a terminal there (no `server:ssh`) is therefore confined to the server's storage root, where
 * `storage:write` already lets it read and write through the file pages; a server without a storage node has no such
 * root to confine it to.
 */
type SyncReachEndpoint = {
	serverId: string;
	path: string;
	unmeteredTreeWrite?: boolean;
	operations: Array<"read" | "write" | "delete">;
	/** Snapshot the runner will actually use for rsync and for credential cleanup. */
	server?: { host: string; port: number; username: string; hostKeySha256: string | null };
};

async function assertSyncTreeAvailable(storageNodeId: string, relativePath: string, write: boolean) {
	await assertNotRecycled(storageNodeId, relativePath, write ? "write" : "read");
	const deleted = await prisma.fileEntry.findFirst({
		where: { storageNodeId, isDeleted: true,
			...(relativePath ? { relativePath: { startsWith: escapeLikeLiteral(`${relativePath}/`) } } : {}) },
		select: { id: true },
	});
	if (deleted) throw new ForbiddenError(t("backend.webdav.destinationHeldByRecycleBin", { path: `/${relativePath}` }));
}

/** Return the canonical paths used by a storage-confined transfer, in endpoint order. */
export async function assertSyncEndpointsWithinReach(
	endpoints: SyncReachEndpoint[],
	session: SyncSessionScope | null | undefined,
): Promise<Awaited<ReturnType<typeof resolveStorageRemotePath>>[] | undefined> {
	if (!session) return;
	const permissions = session.permissions ?? getPermissionsFromRoles(session.roles);
	const confined = !permissions.includes("server:ssh");
	const nodes = await prisma.storageNode.findMany({
		where: { driver: "SFTP", serverId: { in: Array.from(new Set(endpoints.map((endpoint) => endpoint.serverId))) }, ...storageNodeTeamWhere(session) },
		select: { id: true, serverId: true, basePath: true, teamId: true, host: true, port: true, username: true, hostKeySha256: true,
			server: { select: STORAGE_SSH_SERVER_SELECT } },
	});
	const paths: Awaited<ReturnType<typeof resolveStorageRemotePath>>[] = [];
	for (const endpoint of endpoints) {
		const node = nodes.find(node => node.serverId === endpoint.serverId);
		const root = node && expandStorageBasePath(node.basePath);
		const inside = root && syncPathWithinRoot(endpoint.path, root);
		if (confined && !inside) {
			throw new ForbiddenError(root
				? t("backend.sync.endpointOutsideStorageRoot", { path: endpoint.path, root })
				: t("backend.sync.endpointNeedsSshPermission", { path: endpoint.path }));
		}
		if (!node || !root) continue;
		const operations = endpoint.operations;
		const relativePath = inside ? posixPath.relative(root, posixPath.normalize(endpoint.path)) : "";
		if (confined) {
			for (const operation of operations) {
				const access = await assertStorageAccess({ session: { ...session, username: "", mustChangePassword: false }, storageNodeId: node.id, relativePath, operation, ...(endpoint.unmeteredTreeWrite ? { unmeteredTreeWrite: true } : {}) });
				if (!access.allowed) throw new ForbiddenError(storageAccessDeniedCopy(access.reason));
			}
		}
		// A shell-capable caller can name a parent of an indexed root, which includes its whole recycle bin.
		if (inside || syncPathWithinRoot(root, endpoint.path)) {
			await assertSyncTreeAvailable(node.id, relativePath, operations.some(operation => operation !== "read"));
		}
		if (confined) {
			const credentials = resolveStorageSshCredentials(node);
			const server = endpoint.server ?? node.server;
			// Sync opens a server-to-server shell and reclaims secrets through the server records. A node
			// with an independent SSH endpoint cannot safely use that transport.
			if (!server || credentials.host !== server.host || credentials.port !== server.port ||
				credentials.username !== server.username || (credentials.hostKeySha256 ?? null) !== server.hostKeySha256) {
				throw new ForbiddenError(t("backend.command.connectionChanged"));
			}
			if (node.server?.operatingSystem !== "LINUX") throw new ForbiddenError(t("backend.server.linuxOnly"));
			paths.push(await resolveStorageRemotePath({ ...node, basePath: root }, relativePath, { allowRoot: true, credentials }));
		}
	}
	return confined ? paths : undefined;
}

/** A job that deletes what the source lacks may not target a system directory. */
export function assertSafeDeleteTarget(syncType: string | null | undefined, deleteOrphans: boolean, targetPath: string) {
	if (effectiveDeleteOrphans(syncType, deleteOrphans) && isProtectedDeleteTarget(targetPath)) {
		throw new ValidationError(t("backend.sync.deleteTargetIsSystemDirectory"));
	}
}

export async function createSyncJob(input: SyncJobInput) {
	assertDisjointSyncEndpoints(input);
	assertSafeDeleteTarget(input.syncType ?? "MIRROR", input.deleteOrphans ?? false, input.targetPath);
	await assertSyncServersInScope(
		[input.sourceServerId, input.targetServerId],
		input.session ?? null,
	);
	const access = syncEndpointAccess(input.syncType ?? "MIRROR", input.deleteOrphans ?? false);
	await assertSyncEndpointsWithinReach(
		[
			{ serverId: input.sourceServerId, path: input.sourcePath, ...access.source },
			{ serverId: input.targetServerId, path: input.targetPath, ...access.target },
		],
		input.session,
	);
	const teamData = input.session ? teamCreateData(input.session) : {};
	const deleteOrphans = effectiveDeleteOrphans(input.syncType ?? "MIRROR", input.deleteOrphans ?? false);
	return prisma.syncJob.create({
		data: {
			name: input.name,
			sourceServerId: input.sourceServerId,
			sourcePath: input.sourcePath,
			targetServerId: input.targetServerId,
			targetPath: input.targetPath,
			syncType: input.syncType ?? "MIRROR",
			schedule: input.schedule ?? null,
			deleteOrphans,
			compress: input.compress ?? false,
			createdBy: input.createdBy ?? input.session?.userId ?? null,
			...teamData,
		},
		include: {
			sourceServer: serverSummary,
			targetServer: serverSummary,
		},
	});
}

export function syncVisibility(session?: SyncSessionScope, write = false) {
	if (!session) return {};
	const server = serverTeamWhere(session, write ? "connect" : "read");
	return { ...syncJobTeamWhere(session), sourceServer: { is: server }, targetServer: { is: server } };
}

type SyncPaths = Pick<SyncJobInput, "sourceServerId" | "targetServerId" | "sourcePath" | "targetPath">;

export async function visibleSyncPaths(jobs: SyncPaths[], session?: SyncSessionScope, write = false, db: Prisma.TransactionClient = prisma) {
	const permissions = session?.permissions ?? getPermissionsFromRoles(session?.roles ?? []);
	if (!session || jobs.length === 0 || permissions.includes("server:ssh")) return () => true;
	const userId = session.userId;
	const nodes = await db.storageNode.findMany({
		where: { serverId: { in: [...new Set(jobs.flatMap(job => [job.sourceServerId, job.targetServerId]))] }, ...storageNodeTeamWhere(session) },
		select: { serverId: true, basePath: true, accessGrants: { where: { userId }, select: { pathPrefix: true, canRead: true, canWrite: true } } },
	});
	const byServer = new Map(nodes.map(node => [node.serverId, node]));
	const allowed = (serverId: string, path: string, writing: boolean) => {
		const node = byServer.get(serverId);
		if (!node || !permissions.includes(writing ? "storage:write" : "storage:read")) return false;
		const root = expandStorageBasePath(node.basePath);
		if (!syncPathWithinRoot(path, root)) return false;
		if (permissions.includes("storage:manage-node") || node.accessGrants.length === 0) return true;
		return node.accessGrants.some(grant => {
			const prefix = normalizeStorageTargetDirectory(grant.pathPrefix);
			return prefix.ok && (writing ? grant.canWrite : grant.canRead) && syncPathWithinRoot(path, posixPath.join(root, prefix.path));
		});
	};
	return (job: SyncPaths) => allowed(job.sourceServerId, job.sourcePath, false) && allowed(job.targetServerId, job.targetPath, write);
}

export async function listSyncJobs(
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
	const page = (cursor?: string) => prisma.syncJob.findMany({
		where: syncVisibility(session),
		include: {
			sourceServer: serverSummary,
			targetServer: serverSummary,
			creator: { select: { id: true, username: true, displayName: true } },
			_count: { select: { syncLogs: true } },
		},
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
		take: 200,
	});
	const visible: Awaited<ReturnType<typeof page>> = [];
	let cursor: string | undefined;
	do {
		const jobs = await page(cursor);
		visible.push(...jobs.filter(await visibleSyncPaths(jobs, session)));
		cursor = jobs.length === 200 ? jobs.at(-1)?.id : undefined;
	} while (cursor && visible.length < 200);
	return visible.slice(0, 200);
}

/** Endpoint fields the HTTP layer may show; deliberately no credential relation. */
const SYNC_ENDPOINT_SELECT = {
	select: { id: true, name: true, host: true, username: true },
} as const;

/**
 * Read one sync job for display / ownership checks.
 *
 * The endpoint servers are `select`ed rather than `include`d: this row reaches
 * three HTTP routes, and `include: { sshKey: true }` pulled the server's stored
 * private key into every one of them — one `NextResponse.json(job)` away from
 * shipping key material to the browser. Execution needs the credential and gets
 * it from {@link getSyncJobForExecution}.
 */
export async function getSyncJob(
	id: string,
	session?: SyncSessionScope,
	write = false,
) {
	const job = await prisma.syncJob.findFirst({
		where: { id, ...syncVisibility(session, write) },
		include: {
			sourceServer: SYNC_ENDPOINT_SELECT,
			targetServer: SYNC_ENDPOINT_SELECT,
			syncLogs: { orderBy: { startedAt: "desc" }, take: 20 },
		},
	});
	return job && (await visibleSyncPaths([job], session, write))(job) ? job : null;
}

/**
 * Execution-only variant: carries the SSH credentials `runOneWayRsync` needs.
 * Never hand the result to an HTTP response — use {@link getSyncJob} for that.
 * Unscoped by design: the runner is a background worker acting on a job whose
 * ownership was already checked when it was scheduled or triggered.
 */
export async function getSyncJobForExecution(id: string) {
	return prisma.syncJob.findFirst({
		where: { id },
		include: {
			sourceServer: { include: { sshKey: true } },
			targetServer: { include: { sshKey: true } },
		},
	});
}

export async function deleteSyncJob(
	id: string,
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
	return prisma.$transaction(async tx => {
		const where = { id, ...syncVisibility(session, true) };
		const job = await tx.syncJob.findFirst({ where });
		if (!job || !(await visibleSyncPaths([job], session, true, tx))(job)) throw new NotFoundError(t("backend.sync.syncJobNotFound"));
		if (job.status === "RUNNING") throw new ValidationError(t("backend.sync.cannotDeleteRunningSyncJob"));
		const deleted = await tx.syncJob.deleteMany({ where: { ...where, updatedAt: job.updatedAt, status: { not: "RUNNING" } } });
		if (!deleted.count) throw new ValidationError(t("backend.sync.cannotDeleteRunningSyncJob"));
		return { id };
	}, { isolationLevel: "Serializable" });
}

export async function updateSyncJob(
	id: string,
	data: Partial<
		Pick<SyncJobInput, "name" | "sourcePath" | "targetPath" | "syncType" | "deleteOrphans" | "compress">
	> & { schedule?: string | null },
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
	for (let attempt = 0; attempt < 3; attempt++) {
		const existing = await getSyncJob(id, session, true);
		if (!existing) throw new NotFoundError(t("backend.sync.syncJobNotFound"));
		// Being in the job's team is not enough to edit it: the editor must reach both servers itself, the same check
		// createSyncJob makes. Otherwise a member barred from a server could repoint a teammate's job at it.
		if (session) await assertSyncServersInScope([existing.sourceServerId, existing.targetServerId], session);
		// createSyncJob refuses an endpoint that syncs a path onto itself; a PATCH of
		// sourcePath/targetPath must not be able to reach that state either. On one
		// server with the same path and deleteOrphans, the tar fallback pipes
		// `tar cf - -C <path> .` into a remote `find ... -exec rm -rf` on that very
		// path — it would wipe the directory while still reading from it.
		assertDisjointSyncEndpoints({
			sourceServerId: existing.sourceServerId,
			targetServerId: existing.targetServerId,
			sourcePath: data.sourcePath ?? existing.sourcePath,
			targetPath: data.targetPath ?? existing.targetPath,
		});
		assertSafeDeleteTarget(
			data.syncType ?? existing.syncType,
			Boolean(data.deleteOrphans ?? existing.deleteOrphans),
			data.targetPath ?? existing.targetPath,
		);
		if (data.sourcePath !== undefined || data.targetPath !== undefined || data.syncType !== undefined || data.deleteOrphans !== undefined) {
			const access = syncEndpointAccess(data.syncType ?? existing.syncType, data.deleteOrphans ?? existing.deleteOrphans);
			await assertSyncEndpointsWithinReach(
				[
					{ serverId: existing.sourceServerId, path: data.sourcePath ?? existing.sourcePath, ...access.source },
					{ serverId: existing.targetServerId, path: data.targetPath ?? existing.targetPath, ...access.target },
				],
				session,
			);
		}
		const patch: Record<string, unknown> = {};
		if (data.name !== undefined) patch.name = data.name;
		if (data.sourcePath !== undefined) patch.sourcePath = data.sourcePath;
		if (data.targetPath !== undefined) patch.targetPath = data.targetPath;
		if (data.compress !== undefined) patch.compress = data.compress;
		if (data.schedule !== undefined) patch.schedule = data.schedule; // null clears
		if (data.syncType !== undefined || data.deleteOrphans !== undefined) {
			const syncType = data.syncType ?? existing.syncType;
			const deleteOrphans = data.deleteOrphans ?? existing.deleteOrphans;
			patch.deleteOrphans = effectiveDeleteOrphans(syncType, Boolean(deleteOrphans));
			if (data.syncType !== undefined) patch.syncType = data.syncType;
		}
		// A scheduled run acts as the job's creator. Whoever changes what it copies, where, or when becomes that
		// creator, so the run is authorised against the editor's own rights and not a teammate's.
		const changesWhatRuns = data.sourcePath !== undefined || data.targetPath !== undefined || data.schedule !== undefined
			|| data.syncType !== undefined || data.deleteOrphans !== undefined;
		if (session?.userId && changesWhatRuns && session.userId !== existing.createdBy) patch.createdBy = session.userId;
		const result = await prisma.$transaction(async tx => {
			const visible = { id, ...syncVisibility(session, true) };
			const updated = await tx.syncJob.updateMany({
				where: { ...visible, teamId: existing.teamId, updatedAt: existing.updatedAt,
					sourcePath: existing.sourcePath, targetPath: existing.targetPath, syncType: existing.syncType, deleteOrphans: existing.deleteOrphans },
				data: patch,
			});
			if (!updated.count) return null;
			const row = await tx.syncJob.findFirst({
				where: visible, include: { sourceServer: serverSummary, targetServer: serverSummary },
			});
			if (!row || !(await visibleSyncPaths([row], session, true, tx))(row)) throw new NotFoundError(t("backend.sync.syncJobNotFound"));
			return row;
		});
		if (result) return result;
	}
	throw new ConflictError(apiCopy("apiCopy.failed.to.update.sync.job.bf8ef139"));
}
