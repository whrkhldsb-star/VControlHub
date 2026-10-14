/**
 * Status board cost baseline on a disposable database.
 *
 *   DATABASE_URL=postgresql://…/<name containing test|audit|_ci> \
 *     npx tsx scripts/load/public-status-baseline.ts [200 500]
 *
 * For each fleet size it seeds that many published nodes (with latest
 * numbers and one node with 7 days of 5-minute history), then measures the
 * public read paths exactly as the API routes call them:
 * database round trips, JSON body size and wall time, cold (cache empty)
 * and warm (in-process DTO cache). It also confirms that no SSH / TCP
 * collection code ran. Fixtures are removed afterwards. Never point this at
 * a production database: it refuses non-loopback hosts and other names.
 */
import { randomUUID } from "node:crypto";
import net from "node:net";
import { performance } from "node:perf_hooks";
import pg from "pg";

import { prisma } from "@/lib/db";
import { invalidatePublicStatusCache } from "@/lib/public-status/projection";
import { clearPublicHistoryCache, readPublicBoard, readPublicHistory, readPublicNode } from "@/lib/public-status/read";
import { DEFAULT_BOARD_QUERY } from "@/lib/public-status/query";

const url = new URL(process.env.DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) {
	console.error("Refusing to run: DATABASE_URL must be a loopback database whose name contains test, audit or _ci.");
	process.exit(2);
}

/* Any outbound TCP connection other than PostgreSQL would be a probe or SSH. */
const dbPort = Number(url.port || 5432);
const foreignConnections: string[] = [];
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
	const first = args[0] as { port?: number | string; host?: string; path?: string } | number | string;
	const port = typeof first === "object" && first !== null ? Number(first.port) : Number(first);
	const path = typeof first === "object" && first !== null ? first.path : undefined;
	if (!path && port !== dbPort) foreignConnections.push(`${typeof first === "object" ? first.host : args[1]}:${port}`);
	return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;

/* Count every SQL statement at the driver (what PostgreSQL actually receives). */
let roundTrips = 0;
const originalQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
	roundTrips += 1;
	return (originalQuery as (...a: unknown[]) => unknown).apply(this, args);
} as typeof pg.Client.prototype.query;

async function measure<T>(label: string, run: () => Promise<T>) {
	roundTrips = 0;
	const started = performance.now();
	const value = await run();
	const ms = performance.now() - started;
	const bytes = Buffer.byteLength(JSON.stringify(value ?? null));
	return { label, ms: Math.round(ms * 10) / 10, queries: roundTrips, bytes };
}

async function seed(prefix: string, count: number) {
	await prisma.$executeRawUnsafe(
		`INSERT INTO servers (id, name, host, port, username, tags, enabled, "connectionType", "createdAt", "updatedAt")
		 SELECT $1 || lpad(n::text, 5, '0'), 'baseline-' || n, '192.0.2.1', 22, 'fixture', ARRAY[]::text[], true, 'PASSWORD', NOW(), NOW()
		 FROM generate_series(1, $2::int) n`,
		prefix, count,
	);
	await prisma.$executeRawUnsafe(
		`INSERT INTO public_status_nodes (id, "publicId", "serverId", published, "displayName", "groupName", region, tags, "sortOrder", "publishedAt", "createdAt", "updatedAt")
		 SELECT $1 || 'n' || n, translate(substr(md5($1 || n), 1, 12), '0189', 'wxyz'), $1 || lpad(n::text, 5, '0'), true, 'Node ' || n, 'Group ' || (n % 12), 'Region ' || (n % 30), ARRAY['t' || (n % 5)], n, NOW(), NOW(), NOW()
		 FROM generate_series(1, $2::int) n`,
		prefix, count,
	);
	await prisma.$executeRawUnsafe(
		`INSERT INTO server_metric_latest ("serverId", "checkedAt", online, "metricsAt", "metricsSource", "intervalSeconds", "cpuUsage", "cpuCores", load1, load5, load15,
		   "memUsage", "memUsedMb", "memTotalMb", "diskUsage", "diskUsedBytes", "diskTotalBytes", "uptimeSeconds", "netIface", "netRxBytes", "netTxBytes",
		   "rxRateBps", "txRateBps", "rateIntervalSeconds", "periodStart", "periodSince", "periodRxBytes", "periodTxBytes", "probeAt", "probeOk", "probeLatencyMs", "updatedAt")
		 SELECT $1 || lpad(n::text, 5, '0'), NOW(), n % 17 <> 0, NOW(), 'ssh', 300, (n * 7) % 100, 4, 0.5, 0.4, 0.3, (n * 3) % 100, 1024, 4096, (n * 11) % 100,
		   1e10, 4e10, 86400 * (n % 40), 'eth0', 1e9, 1e9, 1e5, 5e4, 300, date_trunc('month', NOW()), date_trunc('month', NOW()), 1e10, 5e9, NOW(), true, 20 + n % 50, NOW()
		 FROM generate_series(1, $2::int) n`,
		prefix, count,
	);
	// 7 days of 5-minute samples for the first node.
	await prisma.$executeRawUnsafe(
		`INSERT INTO metric_snapshots (id, "serverId", "cpuUsage", "memUsage", "diskUsage", "isOnline", "createdAt", "intervalSeconds", "probeStatus", "probeLatencyMs")
		 SELECT $1 || 'm' || n, $1 || '00001', 30, 40, 50, n % 50 <> 0, NOW() - n * interval '5 minutes', 300, CASE WHEN n % 50 = 0 THEN 'failed' ELSE 'ok' END, CASE WHEN n % 50 = 0 THEN NULL ELSE 25 END
		 FROM generate_series(1, 2016) n`,
		prefix,
	);
	await prisma.$executeRawUnsafe(
		`INSERT INTO traffic_snapshots (id, source, "serverId", iface, "rxBytes", "txBytes", "sampledAt")
		 SELECT $1 || 't' || n, 'server', $1 || '00001', 'eth0', (2016 - n) * 3e7, (2016 - n) * 1e7, NOW() - n * interval '5 minutes'
		 FROM generate_series(1, 2016) n`,
		prefix,
	);
	return (await prisma.publicStatusNode.findFirstOrThrow({ where: { serverId: `${prefix}00001` }, select: { publicId: true } })).publicId;
}

async function main() {
	const sizes = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
	const fleet = sizes.length ? sizes : [200, 500];
	const site = await prisma.publicStatusSite.findUnique({ where: { id: "default" } });
	await prisma.publicStatusSite.upsert({ where: { id: "default" }, create: { id: "default", enabled: true }, update: { enabled: true } });
	const results: Array<Record<string, unknown>> = [];
	try {
		for (const count of fleet) {
			const prefix = `baseline-${randomUUID().slice(0, 8)}-`;
			const publicId = await seed(prefix, count);
			try {
				invalidatePublicStatusCache();
				clearPublicHistoryCache();
				const rows = [
					await measure("board cold (page 1, 24/page)", () => readPublicBoard({ ...DEFAULT_BOARD_QUERY })),
					await measure("board warm (page 1, 24/page)", () => readPublicBoard({ ...DEFAULT_BOARD_QUERY })),
					await measure("board warm (100/page)", () => readPublicBoard({ ...DEFAULT_BOARD_QUERY, pageSize: 100 })),
					await measure("board warm (search + sort cpu)", () => readPublicBoard({ ...DEFAULT_BOARD_QUERY, q: "group 3", sort: "cpu", dir: "desc" })),
					await measure("node detail", () => readPublicNode(publicId)),
					await measure("history 24h cold", () => readPublicHistory(publicId, "24h")),
					await measure("history 24h warm", () => readPublicHistory(publicId, "24h")),
					await measure("history 7d cold", () => readPublicHistory(publicId, "7d")),
				];
				for (const row of rows) results.push({ nodes: count, ...row });
			} finally {
				await prisma.server.deleteMany({ where: { id: { startsWith: prefix } } });
			}
		}
	} finally {
		if (site) await prisma.publicStatusSite.update({ where: { id: "default" }, data: { enabled: site.enabled } });
		else await prisma.publicStatusSite.deleteMany({ where: { id: "default" } });
	}
	console.table(results);
	console.log(JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, foreignConnections, results }, null, 2));
	await prisma.$disconnect();
}

void main().catch(async (error) => {
	console.error(error);
	await prisma.$disconnect();
	process.exit(1);
});
