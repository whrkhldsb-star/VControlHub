import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Sync service — DB CRUD (R28 god-file split).
 *
 * Pure prisma operations for `SyncJob`. The execution / orchestration
 * lives in `./service-runtime`; the command strings it produces live in
 * `./service-commands`.
 */
import posixPath from "node:path/posix";

import { prisma } from "@/lib/db";
import { getPermissionsFromRoles, type Permission } from "@/lib/auth/rbac";
import { serverTeamWhere, syncJobTeamWhere, teamCreateData } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { storageNodeTeamWhere } from "@/lib/auth/team-scope";
import { expandStorageBasePath } from "@/lib/storage/path-utils";
import { effectiveDeleteOrphans, isProtectedDeleteTarget, syncEndpointsOverlap } from "./bidirectional";
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
export async function assertSyncEndpointsWithinReach(
	endpoints: Array<{ serverId: string; path: string; operations?: Array<"read" | "write" | "delete"> }>,
	session: SyncSessionScope | null | undefined,
): Promise<void> {
	if (!session) return;
	const permissions = session.permissions ?? getPermissionsFromRoles(session.roles);
	if (permissions.includes("server:ssh")) return;
	const nodes = await prisma.storageNode.findMany({
		where: { serverId: { in: Array.from(new Set(endpoints.map((endpoint) => endpoint.serverId))) }, ...storageNodeTeamWhere(session) },
		select: { id: true, serverId: true, basePath: true },
	});
	for (const endpoint of endpoints) {
		const node = nodes.find((node) => node.serverId === endpoint.serverId && syncPathWithinRoot(endpoint.path, expandStorageBasePath(node.basePath)));
		if (!node) {
			const other = nodes.find((node) => node.serverId === endpoint.serverId);
			throw new ForbiddenError(other
				? t("backend.sync.endpointOutsideStorageRoot", { path: endpoint.path, root: expandStorageBasePath(other.basePath) })
				: t("backend.sync.endpointNeedsSshPermission", { path: endpoint.path }));
		}
		const relativePath = posixPath.relative(expandStorageBasePath(node.basePath), posixPath.normalize(endpoint.path));
		for (const operation of endpoint.operations ?? ["read", "write"]) {
			const access = await assertStorageAccess({ session: { ...session, username: "", mustChangePassword: false }, storageNodeId: node.id, relativePath, operation });
			if (!access.allowed) throw new ForbiddenError(storageAccessDeniedCopy(access.reason));
		}
	}
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
	await assertSyncEndpointsWithinReach(
		[
			{ serverId: input.sourceServerId, path: input.sourcePath },
			{ serverId: input.targetServerId, path: input.targetPath },
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
			sourceServer: { select: { id: true, name: true, host: true } },
			targetServer: { select: { id: true, name: true, host: true } },
		},
	});
}

export async function listSyncJobs(
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
	return prisma.syncJob.findMany({
		where: session ? syncJobTeamWhere(session) : {},
		include: {
			sourceServer: { select: { id: true, name: true, host: true } },
			targetServer: { select: { id: true, name: true, host: true } },
			creator: { select: { id: true, username: true, displayName: true } },
			_count: { select: { syncLogs: true } },
		},
		orderBy: { createdAt: "desc" },
		take: 200,
	});
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
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
	return prisma.syncJob.findFirst({
		where: { id, ...(session ? syncJobTeamWhere(session) : {}) },
		include: {
			sourceServer: SYNC_ENDPOINT_SELECT,
			targetServer: SYNC_ENDPOINT_SELECT,
			syncLogs: { orderBy: { startedAt: "desc" }, take: 20 },
		},
	});
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
	const existing = await getSyncJob(id, session);
	if (!existing) throw new NotFoundError(t("backend.sync.syncJobNotFound"));
	// Do not delete while executeSyncJob holds RUNNING (avoids mid-rsync orphan state).
	if (existing.status === "RUNNING") {
		throw new ValidationError(t("backend.sync.cannotDeleteRunningSyncJob"));
	}
	const deleted = await prisma.syncJob.deleteMany({
		where: { id, status: { not: "RUNNING" }, ...(session ? syncJobTeamWhere(session) : {}) },
	});
	if (deleted.count === 0) {
		throw new ValidationError(t("backend.sync.cannotDeleteRunningSyncJob"));
	}
	return { id };
}

export async function updateSyncJob(
	id: string,
	data: Partial<
		Pick<SyncJobInput, "name" | "sourcePath" | "targetPath" | "syncType" | "deleteOrphans" | "compress">
	> & { schedule?: string | null },
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
	const existing = await getSyncJob(id, session);
	if (!existing) throw new NotFoundError(t("backend.sync.syncJobNotFound"));
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
	if (data.sourcePath !== undefined || data.targetPath !== undefined) {
		await assertSyncEndpointsWithinReach(
			[
				{ serverId: existing.sourceServerId, path: data.sourcePath ?? existing.sourcePath },
				{ serverId: existing.targetServerId, path: data.targetPath ?? existing.targetPath },
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
	const updated = await prisma.syncJob.updateMany({
		where: { id, teamId: existing.teamId ?? null },
		data: patch,
	});
	if (updated.count === 0) {
		throw new NotFoundError(t("backend.sync.syncJobNotFound"));
	}
	const result = await prisma.syncJob.findFirst({
		where: { id, teamId: existing.teamId ?? null },
		include: {
			sourceServer: { select: { id: true, name: true, host: true } },
			targetServer: { select: { id: true, name: true, host: true } },
		},
	});
	if (!result) throw new NotFoundError(t("backend.sync.syncJobNotFound"));
	return result;
}
