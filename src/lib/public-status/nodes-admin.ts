/**
 * Administrator side of node publication. Platform administrators only (the
 * API routes enforce it); every server stays private until an administrator
 * gives it a public name and publishes it.
 */
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { normalizeCountryCode } from "./region-flag";
import { cleanPlainText } from "./site-config";
import { publicationHiddenReason, VISIBLE_NODE_SQL, type HiddenReason } from "./visibility";

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
	/** ISO 3166-1 alpha-2 for the flag; optional for older clients. */
	countryCode: z.string().max(8).nullable().optional(),
	tags: z.array(z.string().max(TAG_MAX * 2)).max(TAGS_MAX),
	sortOrder: z.number().int().min(-100_000).max(100_000),
	note: z.string().max(NOTE_MAX * 2).nullable(),
	maintenance: z.boolean(),
	published: z.boolean(),
}).strict();
export type NodePublicationInput = z.infer<typeof nodePublicationSchema>;

export const nodeBatchSchema = z.object({
	/**
	 * `publish_named` also publishes servers that have no public name yet,
	 * using the server's own name (the administrator confirms that list in
	 * the UI); a name containing the host is refused like any other.
	 */
	action: z.enum(["publish", "publish_named", "unpublish", "maintenance_on", "maintenance_off"]),
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
		countryCode: string | null;
		tags: string[];
		sortOrder: number;
		note: string | null;
		maintenance: boolean;
		publishedAt: string | null;
		hiddenReason: HiddenReason | null;
	} | null;
	lastSampleAt: string | null;
};

function containsHost(server: { host: string }, values: Array<string | null>): boolean {
	const host = server.host.trim().toLowerCase();
	if (!host) return false;
	return values.some((value) => Boolean(value && value.toLowerCase().includes(host)));
}

/** Values that would expose the host must not be published as public text. */
function assertNoHostLeak(server: { host: string; name: string }, values: Array<string | null>) {
	if (containsHost(server, values)) {
		throw new ValidationError(t("backend.publicStatus.containsHost"), { code: "PUBLIC_FIELD_CONTAINS_HOST" });
	}
}

export function normalizePublication(input: NodePublicationInput) {
	const tags = [...new Set(input.tags.map((tag) => singleLine(tag, TAG_MAX)).filter((tag): tag is string => Boolean(tag)))].slice(0, TAGS_MAX);
	const countryInput = (input.countryCode ?? "").trim();
	const countryCode = normalizeCountryCode(countryInput);
	if (countryInput && !countryCode) {
		throw new ValidationError(t("backend.publicStatus.countryCodeInvalid"), { code: "PUBLIC_COUNTRY_CODE_INVALID" });
	}
	return {
		displayName: singleLine(input.displayName, DISPLAY_NAME_MAX),
		groupName: singleLine(input.groupName, GROUP_MAX),
		region: singleLine(input.region, REGION_MAX),
		countryCode,
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
		countryCode: string | null;
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
					countryCode: node.countryCode,
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
	// owner changed) compares two columns, which Prisma cannot express: the
	// page and its total are taken in SQL with the same visibility rule the
	// board uses. Filtering the first 5000 published servers in memory
	// reported "none" while flagged servers sorted after them.
	if (options.filter === "attention") {
		const pattern = q ? `%${escapeLikeLiteral(q)}%` : null;
		const where = Prisma.sql`n."published" = TRUE AND NOT (${VISIBLE_NODE_SQL})
			${pattern ? Prisma.sql`AND (s."name" ILIKE ${pattern} OR n."displayName" ILIKE ${pattern})` : Prisma.empty}`;
		const from = Prisma.sql`FROM servers s JOIN public_status_nodes n ON n."serverId" = s."id" LEFT JOIN teams tm ON tm."id" = s."teamId"`;
		const [[counted], page] = await Promise.all([
			prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`SELECT count(*)::int AS total ${from} WHERE ${where}`),
			prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT s."id" ${from} WHERE ${where}
				ORDER BY s."name" ASC, s."id" ASC OFFSET ${(options.page - 1) * options.pageSize} LIMIT ${options.pageSize}`),
		]);
		const ids = page.map((row) => row.id);
		const rows = ids.length === 0 ? [] : await prisma.server.findMany({ where: { id: { in: ids } }, select: SERVER_SELECT });
		const byId = new Map(rows.map((row) => [row.id, row]));
		return {
			total: counted?.total ?? 0,
			rows: ids.flatMap((id) => (byId.has(id) ? [toAdminRow(byId.get(id)!)] : [])),
		};
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
		countryCode: values.countryCode,
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

/**
 * Publish the chosen servers, giving the ones without a public name their
 * server name. Skips servers that no longer exist and names that contain the
 * host. All-or-nothing, like `publish`.
 */
async function publishWithServerNames(ids: string[], actorId: string) {
	const servers = await prisma.server.findMany({
		where: { id: { in: ids } },
		select: { id: true, name: true, host: true, teamId: true, publicStatusNode: { select: { displayName: true } } },
	});
	const found = new Set(servers.map((server) => server.id));
	const skipped = ids.filter((id) => !found.has(id));
	const now = new Date();
	const updates = [];
	for (const server of servers) {
		const current = server.publicStatusNode?.displayName.trim() || null;
		const name = current ?? singleLine(server.name, DISPLAY_NAME_MAX);
		if (!name || containsHost(server, [name])) {
			skipped.push(server.id);
			continue;
		}
		const published = { published: true, publishedTeamId: server.teamId, publishedAt: now, publishedById: actorId };
		updates.push(prisma.publicStatusNode.upsert({
			where: { serverId: server.id },
			create: { serverId: server.id, publicId: generatePublicId(), displayName: name, ...published },
			update: current ? published : { displayName: name, ...published },
		}));
	}
	await prisma.$transaction(updates);
	return { changed: updates.length, skipped };
}

export async function applyNodeBatch(input: NodeBatchInput, actorId: string) {
	const ids = [...new Set(input.serverIds)];
	if (input.action === "publish_named") return publishWithServerNames(ids, actorId);
	const nodes = await prisma.publicStatusNode.findMany({
		where: { serverId: { in: ids } },
		select: { serverId: true, displayName: true, server: { select: { teamId: true } } },
	});
	const configured = new Map(nodes.map((node) => [node.serverId, node]));
	const skipped = ids.filter((id) => !configured.has(id));
	const targets = ids.filter((id) => configured.has(id));
	let changed = 0;
	if (input.action === "publish") {
		// One statement per node keeps the per-node owner snapshot exact. They
		// run in one transaction: a failure part-way (e.g. a node removed in
		// the meantime) must not leave earlier nodes public while the request
		// reports an error and skips the audit entry and cache invalidation.
		const now = new Date();
		const updates = [];
		for (const id of targets) {
			const node = configured.get(id)!;
			if (!node.displayName.trim()) {
				skipped.push(id);
				continue;
			}
			updates.push(prisma.publicStatusNode.update({
				where: { serverId: id },
				data: { published: true, publishedTeamId: node.server.teamId, publishedAt: now, publishedById: actorId },
			}));
		}
		await prisma.$transaction(updates);
		changed = updates.length;
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
