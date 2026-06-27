import { NextResponse } from "next/server";
import { z } from "zod";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { SERVICE_CATALOG } from "@/lib/quick-service/catalog";
import { getRemoteApps } from "@/lib/quick-service/app-source-sync";
import { listQuickServices } from "@/lib/quick-service/service";

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
					OR: [
						{ name: { contains: q, mode: "insensitive" } },
						{ host: { contains: q, mode: "insensitive" } },
						{ description: { contains: q, mode: "insensitive" } },
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
				href: "/servers",
				icon: "🖥️",
				category: "server" as const,
			})));
		}

		if (session && sessionHasPermission(session, "playbook:read")) {
			const playbooks = await prisma.playbook.findMany({
				where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] },
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
			const installed = await listQuickServices();
			const remoteApps = await getRemoteApps();
			const quickServices = [
				...SERVICE_CATALOG.map((item) => ({ slug: item.slug, name: item.name, description: item.description, source: "catalog" })),
				...installed.map((item) => ({ slug: item.slug, name: item.name, description: item.description, source: item.status })),
				...remoteApps.map((item) => ({ slug: item.slug, name: item.name, description: item.description, source: item.sourceName })),
			]
				.filter((item, index, list) => list.findIndex((candidate) => candidate.slug === item.slug) === index)
				.filter((item) => includesQuery([item.name, item.slug, item.description, item.source], q))
				.slice(0, take);

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
