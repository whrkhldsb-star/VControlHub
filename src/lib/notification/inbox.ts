import { Prisma } from "@prisma/client";
import { isGlobalTeamManager, rawServerScope, type TeamSession } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";

export const PLATFORM_ANNOUNCEMENT = "announcement";

/** A stored notification row: as much of it as the recipient's open pages are told. */
export type StoredNotification = {
	id: string;
	type: string;
	userId: string;
	title: string;
	message: string;
	messageCode: string | null;
	messageParams: unknown;
	actionUrl: string | null;
	teamId: string | null;
	createdAt: Date;
};

/** The columns of a `StoredNotification`, for a `select`. */
export const STORED_NOTIFICATION_SELECT = {
	id: true,
	type: true,
	userId: true,
	title: true,
	message: true,
	messageCode: true,
	messageParams: true,
	actionUrl: true,
	teamId: true,
	createdAt: true,
} as const;

/** Worker pushes and older page callers only have the account id. A customer
 * account has exactly one live membership, the same source as session verification. */
export async function currentRecipient(userId: string): Promise<TeamSession | null> {
	const user = await prisma.user.findUnique({
		where: { id: userId, status: { not: "DISABLED" } },
		select: {
			roles: { where: { role: { key: "admin" } }, select: { roleId: true } },
			teamMembership: { select: { teamId: true, team: { select: { deletedAt: true } } } },
		},
	});
	if (!user) return null;
	const membership = user.teamMembership;
	return {
		userId,
		roles: user.roles.length ? ["admin"] : [],
		currentTeamId: membership && !membership.team.deletedAt ? membership.teamId : null,
	};
}

export function inboxWhere(session: TeamSession): Prisma.NotificationWhereInput {
	const { userId, currentTeamId } = session;
	if (isGlobalTeamManager(session)) return { userId };
	const announcement = { teamId: null, type: PLATFORM_ANNOUNCEMENT };
	return { userId, OR: currentTeamId ? [{ teamId: currentTeamId }, announcement] : [announcement] };
}

export function pushPayload(row: StoredNotification) {
	return {
		id: row.id,
		title: row.title,
		message: row.message,
		messageCode: row.messageCode,
		messageParams: row.messageParams,
		actionUrl: row.actionUrl,
		teamId: row.teamId,
		createdAt: row.createdAt.toISOString(),
	};
}

/** Socket delivery has no request session. Resolve membership, account status
 * and the notification together so a transfer cannot mix two database snapshots. */
function incidentReadable(hostScope: Prisma.Sql) {
	return Prisma.sql`(n.type NOT IN ('server_alert', 'alert_resolved')
		OR COALESCE(n."actionUrl", '') NOT LIKE '/alert-rules?incident=%'
		OR EXISTS (SELECT 1 FROM alert_incidents i JOIN alert_rules ar ON ar.id = i."ruleId"
			WHERE n."actionUrl" = '/alert-rules?incident=' || i.id AND ar."teamId" IS NOT DISTINCT FROM n."teamId"
			AND (i."serverId" IS NULL OR EXISTS (SELECT 1 FROM servers s WHERE s.id = i."serverId" AND ${hostScope}))))`;
}

function customerInbox(session: TeamSession) {
	return Prisma.sql`FROM notifications n WHERE n."userId" = ${session.userId}
		AND (n."teamId" = ${session.currentTeamId} OR (n."teamId" IS NULL AND n.type = ${PLATFORM_ANNOUNCEMENT}))
		AND ${incidentReadable(rawServerScope(session, "canRead"))}`;
}

function liveInbox(userId: string) {
	return Prisma.sql`FROM notifications n
		JOIN "User" u ON u.id = n."userId"
		LEFT JOIN team_members m ON m."userId" = u.id
		LEFT JOIN teams t ON t.id = m."teamId" AND t."deletedAt" IS NULL
		WHERE u.id = ${userId} AND u.status <> 'DISABLED' AND (
			(n."teamId" = t.id AND ${incidentReadable(Prisma.sql`s."teamId" = t.id AND NOT EXISTS
				(SELECT 1 FROM user_server_access a WHERE a."serverId" = s.id AND a."userId" = u.id AND NOT a."canRead")`)}) OR (n."teamId" IS NULL AND n.type = ${PLATFORM_ANNOUNCEMENT})
			OR EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId"
				WHERE ur."userId" = u.id AND r.key = 'admin')
		)`;
}

export async function getVisibleNotificationForPush(userId: string, id: string) {
	const [row] = await prisma.$queryRaw<StoredNotification[]>`SELECT n.* ${liveInbox(userId)} AND n.id = ${id}`;
	return row ? pushPayload(row) : null;
}

export async function listUserNotifications(viewer: TeamSession | string, opts?: { unreadOnly?: boolean; limit?: number; skip?: number }) {
	const session = typeof viewer === "string" ? await currentRecipient(viewer) : viewer;
	if (!session) return [];
	if (!isGlobalTeamManager(session)) {
		return prisma.$transaction(async (tx) => {
			const ids = await tx.$queryRaw<{ id: string }[]>`SELECT n.id ${customerInbox(session)}
				${opts?.unreadOnly ? Prisma.sql`AND NOT n."isRead"` : Prisma.empty}
				ORDER BY n."createdAt" DESC, n.id DESC LIMIT ${opts?.limit ?? 50} OFFSET ${opts?.skip ?? 0}`;
			return tx.notification.findMany({
				where: { id: { in: ids.map((row) => row.id) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				include: { team: { select: { name: true } } },
			});
		}, { isolationLevel: "RepeatableRead" });
	}
	return prisma.notification.findMany({
		where: {
			...inboxWhere(session),
			...(opts?.unreadOnly ? { isRead: false } : {}),
		},
		// The id breaks createdAt ties, so offset pages neither repeat nor skip.
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: opts?.limit ?? 50,
		...(opts?.skip && opts.skip > 0 ? { skip: opts.skip } : {}),
		// Administrators receive notifications from every customer; name the source.
		include: { team: { select: { name: true } } },
	});
}

export async function getUnreadCount(viewer: TeamSession | string): Promise<number> {
	const session = typeof viewer === "string" ? await currentRecipient(viewer) : viewer;
	if (!session) return 0;
	if (!isGlobalTeamManager(session)) {
		const [row] = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count ${customerInbox(session)} AND NOT n."isRead"`;
		return row?.count ?? 0;
	}
	return prisma.notification.count({
		where: { ...inboxWhere(session), isRead: false },
	});
}

/**
 * The unread count with the moment its counting statement started, in
 * microseconds of database time. Counts are pushed from several places and
 * processes (the web server, the worker through the notification bus) and
 * can arrive out of order: a count read earlier must not replace one read
 * later, so the browser keeps the newest by this stamp.
 */
export async function readUnreadCount(userId: string): Promise<{ count: number; asOfUs: number }> {
	const [row] = await prisma.$queryRaw<Array<{ count: number; asOfUs: bigint }>>`
		SELECT count(*)::int AS count, (extract(epoch FROM statement_timestamp()) * 1000000)::bigint AS "asOfUs"
		${liveInbox(userId)} AND n."isRead" = false`;
	return { count: row?.count ?? 0, asOfUs: Number(row?.asOfUs ?? 0) };
}
