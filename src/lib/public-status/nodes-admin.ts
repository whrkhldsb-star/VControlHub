/**
 * Administrator side of node publication. Platform administrators only (the
 * API routes enforce it); every server stays private until an administrator
 * gives it a public name and publishes it.
 */
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { cleanPlainText } from "./site-config";
import { publicationHiddenReason, type HiddenReason } from "./visibility";

export const DISPLAY_NAME_MAX = 60;
export const GROUP_MAX = 40;
export const REGION_MAX = 40;
export const TAG_MAX = 24;
export const TAGS_MAX = 10;
export const NOTE_MAX = 280;
export const BATCH_MAX = 200;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** 12 random base32 characters (60 bits), unrelated to any internal id. */
export function generatePublicId(): string {
	const bytes = randomBytes(12);
	let out = "";
	for (const byte of bytes) out += BASE32[byte & 31];
	return out;
}

function singleLine(value: string | null | undefined, max: number): string | null {
	const cleaned = cleanPlainText(value, max * 2);
	if (!cleaned) return null;
	return cleaned.replace(/\s+/g, " ").slice(0, max);
}

export const nodePublicationSchema = z.object({
	displayName: z.string().max(DISPLAY_NAME_MAX * 2),
	groupName: z.string().max(GROUP_MAX * 2).nullable(),
	region: z.string().max(REGION_MAX * 2).nullable(),
	tags: z.array(z.string().max(TAG_MAX * 2)).max(TAGS_MAX),
	sortOrder: z.number().int().min(-100_000).max(100_000),
	note: z.string().max(NOTE_MAX * 2).nullable(),
	maintenance: z.boolean(),
	published: z.boolean(),
}).strict();
export type NodePublicationInput = z.infer<typeof nodePublicationSchema>;

export const nodeBatchSchema = z.object({
	action: z.enum(["publish", "unpublish", "maintenance_on", "maintenance_off"]),
	serverIds: z.array(z.string().min(1).max(64)).min(1).max(BATCH_MAX),
}).strict();
export type NodeBatchInput = z.infer<typeof nodeBatchSchema>;

export type AdminNodeFilter = "all" | "published" | "unpublished" | "attention";

export type AdminNodeRow = {
	serverId: string;
	serverName: string;
	customerName: string | null;
	enabled: boolean;
	managementMode: "DIRECT" | "AGENT";
	publication: {
		publicId: string;
		published: boolean;
		displayName: string;
		groupName: string | null;
		region: string | null;
		tags: string[];
		sortOrder: number;
		note: string | null;
		maintenance: boolean;
		publishedAt: string | null;
		hiddenReason: HiddenReason | null;
	} | null;
	lastSampleAt: string | null;
};

/** Values that would expose the host must not be published as public text. */
function assertNoHostLeak(server: { host: string; name: string }, values: Array<string | null>) {
	const host = server.host.trim().toLowerCase();
	if (!host) return;
	for (const value of values) {
		if (value && value.toLowerCase().includes(host)) {
			throw new ValidationError(t("backend.publicStatus.containsHost"), { code: "PUBLIC_FIELD_CONTAINS_HOST" });
		}
	}
}

export function normalizePublication(input: NodePublicationInput) {
	const tags = [...new Set(input.tags.map((tag) => singleLine(tag, TAG_MAX)).filter((tag): tag is string => Boolean(tag)))].slice(0, TAGS_MAX);
	return {
		displayName: singleLine(input.displayName, DISPLAY_NAME_MAX),
		groupName: singleLine(input.groupName, GROUP_MAX),
		region: singleLine(input.region, REGION_MAX),
		tags,
		sortOrder: input.sortOrder,
		note: cleanPlainText(input.note, NOTE_MAX),
		maintenance: input.maintenance,
		published: input.published,
	};
}

const SERVER_SELECT = {
	id: true,
	name: true,
	host: true,
	enabled: true,
	teamId: true,
	managementMode: true,
	team: { select: { name: true, deletedAt: true } },
	metricLatest: { select: { metricsAt: true } },
	publicStatusNode: true,
} as const;

type ServerWithPublication = {
	id: string;
	name: string;
	enabled: boolean;
	teamId: string | null;
	managementMode: "DIRECT" | "AGENT";
	team: { name: string; deletedAt: Date | null } | null;
	metricLatest: { metricsAt: Date | null } | null;
	publicStatusNode: {
		publicId: string;
		published: boolean;
		publishedTeamId: string | null;
		displayName: string;
		groupName: string | null;
		region: string | null;
		tags: string[];
		sortOrder: number;
		note: string | null;
		maintenance: boolean;
		publishedAt: Date | null;
	} | null;
};

function toAdminRow(server: ServerWithPublication): AdminNodeRow {
	const node = server.publicStatusNode;
	return {
		serverId: server.id,
		serverName: server.name,
		customerName: server.team?.name ?? null,
		enabled: server.enabled,
		managementMode: server.managementMode,
		publication: node
			? {
					publicId: node.publicId,
					published: node.published,
					displayName: node.displayName,
					groupName: node.groupName,
					region: node.region,
					tags: node.tags,
					sortOrder: node.sortOrder,
					note: node.note,
					maintenance: node.maintenance,
					publishedAt: node.publishedAt?.toISOString() ?? null,
					hiddenReason: publicationHiddenReason({
						published: node.published,
						publishedTeamId: node.publishedTeamId,
						server: { enabled: server.enabled, teamId: server.teamId, team: server.team },
					}),
				}
			: null,
		lastSampleAt: server.metricLatest?.metricsAt?.toISOString() ?? null,
	};
}

export async function listAdminNodes(options: { q: string; filter: AdminNodeFilter; page: number; pageSize: number }) {
	const q = options.q.trim().slice(0, 100);
	const search: Prisma.ServerWhereInput = q
		? {
				OR: [
					{ name: { contains: q, mode: "insensitive" } },
					{ publicStatusNode: { is: { displayName: { contains: q, mode: "insensitive" } } } },
				],
			}
		: {};
	const published: Prisma.ServerWhereInput = { publicStatusNode: { is: { published: true } } };
	const unpublished: Prisma.ServerWhereInput = { OR: [{ publicStatusNode: { is: null } }, { publicStatusNode: { is: { published: false } } }] };
	// "attention" (published but no longer shown: disabled, deleted customer,
	// owner changed) needs a column-to-column comparison Prisma cannot
	// express, so it filters the published set in memory.
	if (options.filter === "attention") {
		const rows = await prisma.server.findMany({
			where: { AND: [search, published] },
			select: SERVER_SELECT,
			orderBy: [{ name: "asc" }, { id: "asc" }],
			take: 5_000,
		});
		const flagged = rows.map(toAdminRow).filter((row) => row.publication?.hiddenReason);
		const start = (options.page - 1) * options.pageSize;
		return { total: flagged.length, rows: flagged.slice(start, start + options.pageSize) };
	}
	const where: Prisma.ServerWhereInput = {
		AND: [search, options.filter === "published" ? published : options.filter === "unpublished" ? unpublished : {}],
	};
	const [total, rows] = await Promise.all([
		prisma.server.count({ where }),
		prisma.server.findMany({
			where,
			select: SERVER_SELECT,
			orderBy: [{ name: "asc" }, { id: "asc" }],
			skip: (options.page - 1) * options.pageSize,
			take: options.pageSize,
		}),
	]);
	return { total, rows: rows.map(toAdminRow) };
}

export async function updateNodePublication(serverId: string, input: NodePublicationInput, actorId: string) {
	const server = await prisma.server.findUnique({ where: { id: serverId }, select: { id: true, name: true, host: true, teamId: true } });
	if (!server) throw new NotFoundError(t("backend.publicStatus.serverNotFound"));
	const values = normalizePublication(input);
	if (!values.displayName) {
		throw new ValidationError(t("backend.publicStatus.nameRequired"), { code: "PUBLIC_NAME_REQUIRED" });
	}
	assertNoHostLeak(server, [values.displayName, values.groupName, values.region, values.note, ...values.tags]);
	const existing = await prisma.publicStatusNode.findUnique({ where: { serverId }, select: { published: true, publishedAt: true } });
	const publishing = values.published;
	const data = {
		displayName: values.displayName,
		groupName: values.groupName,
		region: values.region,
		tags: values.tags,
		sortOrder: values.sortOrder,
		note: values.note,
		maintenance: values.maintenance,
		published: publishing,
		// Saving as published confirms the server's current owner.
		...(publishing
			? {
					publishedTeamId: server.teamId,
					publishedAt: existing?.published ? existing.publishedAt ?? new Date() : new Date(),
					publishedById: actorId,
				}
			: { publishedAt: null }),
	};
	const saved = await prisma.publicStatusNode.upsert({
		where: { serverId },
		create: { serverId, publicId: generatePublicId(), ...data },
		update: data,
		select: { publicId: true, published: true },
	});
	return { ...saved, wasPublished: existing?.published ?? false };
}

export async function applyNodeBatch(input: NodeBatchInput, actorId: string) {
	const ids = [...new Set(input.serverIds)];
	const nodes = await prisma.publicStatusNode.findMany({
		where: { serverId: { in: ids } },
		select: { serverId: true, displayName: true, server: { select: { teamId: true } } },
	});
	const configured = new Map(nodes.map((node) => [node.serverId, node]));
	const skipped = ids.filter((id) => !configured.has(id));
	const targets = ids.filter((id) => configured.has(id));
	let changed = 0;
	if (input.action === "publish") {
		// One statement per node keeps the per-node owner snapshot exact.
		const now = new Date();
		for (const id of targets) {
			const node = configured.get(id)!;
			if (!node.displayName.trim()) {
				skipped.push(id);
				continue;
			}
			await prisma.publicStatusNode.update({
				where: { serverId: id },
				data: { published: true, publishedTeamId: node.server.teamId, publishedAt: now, publishedById: actorId },
			});
			changed += 1;
		}
	} else if (input.action === "unpublish") {
		changed = (await prisma.publicStatusNode.updateMany({ where: { serverId: { in: targets } }, data: { published: false, publishedAt: null } })).count;
	} else {
		changed = (await prisma.publicStatusNode.updateMany({
			where: { serverId: { in: targets } },
			data: { maintenance: input.action === "maintenance_on" },
		})).count;
	}
	return { changed, skipped };
}
