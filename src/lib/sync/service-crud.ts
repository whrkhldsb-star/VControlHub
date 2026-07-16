/**
 * Sync service — DB CRUD (R28 god-file split).
 *
 * Pure prisma operations for `SyncJob`. The execution / orchestration
 * lives in `./service-runtime`; the command strings it produces live in
 * `./service-commands`.
 */
import { prisma } from "@/lib/db";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { effectiveDeleteOrphans } from "./bidirectional";

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
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
};

export async function createSyncJob(input: SyncJobInput) {
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
		where: session ? teamWhere(session) : {},
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

export async function getSyncJob(
	id: string,
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
	return prisma.syncJob.findFirst({
		where: { id, ...(session ? teamWhere(session) : {}) },
		include: {
			sourceServer: { include: { sshKey: true } },
			targetServer: { include: { sshKey: true } },
			syncLogs: { orderBy: { startedAt: "desc" }, take: 20 },
		},
	});
}

export async function deleteSyncJob(
	id: string,
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
	const existing = await getSyncJob(id, session);
	if (!existing) throw new NotFoundError("Sync job not found");
	return prisma.syncJob.delete({ where: { id } });
}

export async function updateSyncJob(
	id: string,
	data: Partial<Pick<SyncJobInput, "name" | "sourcePath" | "targetPath" | "syncType" | "schedule" | "deleteOrphans" | "compress">>,
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
	const existing = await getSyncJob(id, session);
	if (!existing) throw new NotFoundError("Sync job not found");
	const patch: Record<string, unknown> = { ...data };
	if (data.syncType !== undefined || data.deleteOrphans !== undefined) {
		const syncType = data.syncType ?? existing.syncType;
		const deleteOrphans = data.deleteOrphans ?? existing.deleteOrphans;
		patch.deleteOrphans = effectiveDeleteOrphans(syncType, deleteOrphans);
		if (data.syncType !== undefined) patch.syncType = data.syncType;
	}
	return prisma.syncJob.update({ where: { id }, data: patch });
}
