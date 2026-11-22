import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { isGlobalTeamManager, playbookTeamWhere, serverTeamWhere } from "@/lib/auth/team-scope";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { SERVICE_CATALOG } from "@/lib/quick-service/catalog";
import { getRemoteApps } from "@/lib/quick-service/app-source-sync";

export const dynamic = "force-dynamic";

const searchQuerySchema = z.object({
	q: z.string().trim().min(1).max(80),
	limit: z.coerce.number().int().min(1).max(20).default(8),
});

type SearchResult = {
	id: string;
	label: string;
	description?: string | null;
	href: string;
	icon: string;
	category: "server" | "playbook" | "quick-service";
};

function includesQuery(values: Array<string | null | undefined>, query: string) {
	const normalized = query.toLowerCase();
	return values.some((value) => value?.toLowerCase().includes(normalized));
}

export async function GET(request: Request) {
	return withApiRoute(request, { requireAuth: true, querySchema: searchQuerySchema }, async ({ session, query }) => {
		const results: SearchResult[] = [];
		const q = query.q;
		const take = query.limit;

		if (session && sessionHasPermission(session, "server:read")) {
			const servers = await prisma.server.findMany({
				where: {
					...serverTeamWhere(session),
					OR: [
						{ name: { contains: escapeLikeLiteral(q), mode: "insensitive" } },
						{ host: { contains: escapeLikeLiteral(q), mode: "insensitive" } },
						{ description: { contains: escapeLikeLiteral(q), mode: "insensitive" } },
						{ tags: { has: q } },
					],
				},
				select: { id: true, name: true, host: true, description: true },
				orderBy: { updatedAt: "desc" },
				take,
			});
			results.push(...servers.map((server) => ({
				id: `server:${server.id}`,
				label: server.name,
				description: server.description ?? server.host,
				// The server list filtered to this server. It was /servers?highlight=<id>, which that page never read:
				// the hit opened the first page of all servers.
				href: `/servers?query=${encodeURIComponent(server.name)}`,
				icon: "🖥️",
				category: "server" as const,
			})));
		}

		if (session && sessionHasPermission(session, "playbook:read")) {
			const playbooks = await prisma.playbook.findMany({
				where: {
					AND: [
						// Strict, matching the playbook service: search must not hand a
						// `teamId: null` playbook id to a tenant that cannot run it.
						playbookTeamWhere(session),
						{
							OR: [
								{ name: { contains: escapeLikeLiteral(q), mode: "insensitive" } },
								{ description: { contains: escapeLikeLiteral(q), mode: "insensitive" } },
							],
						},
					],
				},
				select: { id: true, name: true, description: true },
				orderBy: { updatedAt: "desc" },
				take,
			});
			results.push(...playbooks.map((playbook) => ({
				id: `playbook:${playbook.id}`,
				label: playbook.name,
				description: playbook.description,
				href: "/playbooks",
				icon: "📘",
				category: "playbook" as const,
			})));
		}

		if (session && sessionHasPermission(session, "docker:manage")) {
			const contains = { contains: escapeLikeLiteral(q), mode: "insensitive" } as const;
			const fields: Prisma.QuickServiceWhereInput[] = ["name", "slug", "description", "status", "instanceKey"]
				.map(field => ({ [field]: contains }));
			const separator = q.indexOf("@");
			if (separator >= 0) {
				// A remote instance was also searchable by its status@instanceKey display value.
				fields.push({
					status: { endsWith: escapeLikeLiteral(q.slice(0, separator)), mode: "insensitive" },
					instanceKey: { not: "hub-host", startsWith: escapeLikeLiteral(q.slice(separator + 1)), mode: "insensitive" },
				});
			}
			const installed = await prisma.quickService.findMany({
				where: {
					// QuickService has no teamId of its own. Remote installs
					// (serverId set) inherit their server's tenant, so scope them by
					// the strict server root to stop a team operator enumerating
					// another team's VPS inventory. Hub-host installs (serverId null)
					// run on the platform's own Docker daemon, which only platform
					// managers may address (assertHubHostDockerAccess) — the same rule
					// applies to listing them here.
					AND: [{ OR: fields }],
					OR: [
						...(isGlobalTeamManager(session) ? [{ serverId: null }] : []),
						{ server: serverTeamWhere(session) },
					],
				},
				orderBy: [{ category: "asc" }, { name: "asc" }],
				distinct: ["slug"],
				take,
				select: { slug: true, name: true, description: true },
			});
			const remoteApps = await getRemoteApps();
			const matches = [
				...SERVICE_CATALOG.filter(item => includesQuery([item.name, item.slug, item.description, "catalog"], q)),
				...installed,
				...remoteApps.filter(item => includesQuery([item.name, item.slug, item.description, item.sourceName], q)),
			];
			const seen = new Set<string>();
			const quickServices = matches.filter(item => {
				if (seen.has(item.slug)) return false;
				seen.add(item.slug);
				return true;
			}).slice(0, take);

			results.push(...quickServices.map((item) => ({
				id: `quick-service:${item.slug}`,
				label: item.name,
				description: item.description,
				href: "/quick-services",
				icon: "⚡",
				category: "quick-service" as const,
			})));
		}

		return NextResponse.json({ results: results.slice(0, take * 3) });
	});
}
