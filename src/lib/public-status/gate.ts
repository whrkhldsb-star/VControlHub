/**
 * Checks the proxy runs before a public page starts streaming, so the
 * response can carry a real status code: the root `loading.tsx` makes every
 * page stream a 200 shell first, after which `notFound()` / `redirect()` can
 * only be signalled inside the body (see Next.js "loading.js → Status Codes").
 *
 * Each check is one indexed query and never touches a host.
 */
import { prisma } from "@/lib/db";
import { PUBLIC_ID_PATTERN } from "./query";
import { VISIBLE_NODE_SQL } from "./visibility";

/** True when the board is open to visitors. */
export async function isPublicBoardOpen(): Promise<boolean> {
	const row = await prisma.publicStatusSite.findUnique({ where: { id: "default" }, select: { enabled: true } });
	return row?.enabled === true;
}

/** True when the board is open and this public id is visible right now. */
export async function isPublicNodeVisible(publicId: string): Promise<boolean> {
	if (!PUBLIC_ID_PATTERN.test(publicId)) return false;
	const rows = await prisma.$queryRaw<Array<{ ok: number }>>`
		SELECT 1 AS ok
		FROM "public_status_nodes" n
		JOIN "servers" s ON s."id" = n."serverId"
		LEFT JOIN "teams" tm ON tm."id" = s."teamId"
		JOIN "public_status_sites" site ON site."id" = 'default' AND site."enabled" = TRUE
		WHERE n."publicId" = ${publicId} AND ${VISIBLE_NODE_SQL}
		LIMIT 1`;
	return rows.length > 0;
}
