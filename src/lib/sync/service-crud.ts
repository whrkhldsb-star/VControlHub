/**
 * Sync service — DB CRUD (R28 god-file split).
 *
 * Pure prisma operations for `SyncJob`. The execution / orchestration
 * lives in `./service-runtime`; the command strings it produces live in
 * `./service-commands`.
 */
import { prisma } from "@/lib/db";

export type SyncJobInput = {
	name: string;
	sourceServerId: string;
	sourcePath: string;
	targetServerId: string;
	targetPath: string;
	syncType?: "MIRROR" | "BACKUP" | "INCREMENTAL";
	schedule?: string;
	deleteOrphans?: boolean;
	compress?: boolean;
	createdBy?: string;
};

export async function createSyncJob(input: SyncJobInput) {
	return prisma.syncJob.create({
		data: {
			name: input.name,
			sourceServerId: input.sourceServerId,
			sourcePath: input.sourcePath,
			targetServerId: input.targetServerId,
			targetPath: input.targetPath,
			syncType: input.syncType ?? "MIRROR",
			schedule: input.schedule ?? null,
			deleteOrphans: input.deleteOrphans ?? false,
			compress: input.compress ?? false,
			createdBy: input.createdBy ?? null,
		},
		include: {
			sourceServer: { select: { id: true, name: true, host: true } },
			targetServer: { select: { id: true, name: true, host: true } },
		},
	});
}

export async function listSyncJobs() {
	return prisma.syncJob.findMany({
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

export async function getSyncJob(id: string) {
	return prisma.syncJob.findUnique({
		where: { id },
		include: {
			sourceServer: { include: { sshKey: true } },
			targetServer: { include: { sshKey: true } },
			syncLogs: { orderBy: { startedAt: "desc" }, take: 20 },
		},
	});
}

export async function deleteSyncJob(id: string) {
	return prisma.syncJob.delete({ where: { id } });
}

export async function updateSyncJob(id: string, data: Partial<Pick<SyncJobInput, "name" | "sourcePath" | "targetPath" | "syncType" | "schedule" | "deleteOrphans" | "compress">>) {
	return prisma.syncJob.update({ where: { id }, data });
}
