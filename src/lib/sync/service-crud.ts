import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Sync service — DB CRUD (R28 god-file split).
 *
 * Pure prisma operations for `SyncJob`. The execution / orchestration
 * lives in `./service-runtime`; the command strings it produces live in
 * `./service-commands`.
 */
import { prisma } from "@/lib/db";
import { serverTeamWhere, syncJobTeamWhere, teamCreateData } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { effectiveDeleteOrphans, normalizeSyncEndpointPath } from "./bidirectional";
import { t } from "@/lib/i18n/service-translations";

export type SyncSessionScope = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

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

function assertDistinctSyncEndpoints(input: Pick<SyncJobInput, "sourceServerId" | "targetServerId" | "sourcePath" | "targetPath">) {
	if (
		input.sourceServerId === input.targetServerId &&
		normalizeSyncEndpointPath(input.sourcePath) === normalizeSyncEndpointPath(input.targetPath)
	) {
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
	const scope = session ? serverTeamWhere(session) : {};
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

export async function createSyncJob(input: SyncJobInput) {
	assertDistinctSyncEndpoints(input);
	await assertSyncServersInScope(
		[input.sourceServerId, input.targetServerId],
		input.session ?? null,
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
	assertDistinctSyncEndpoints({
		sourceServerId: existing.sourceServerId,
		targetServerId: existing.targetServerId,
		sourcePath: data.sourcePath ?? existing.sourcePath,
		targetPath: data.targetPath ?? existing.targetPath,
	});
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
