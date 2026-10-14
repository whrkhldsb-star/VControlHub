/**
 * Public status board, end to end, against an isolated database:
 * visitor board + node detail, root entry, closed board, guessed ids,
 * administrator publish → visitor sees → unpublish → gone, views, filters,
 * pagination beyond 200 nodes, history ranges, theme and narrow viewports.
 *
 * Fixtures (public / hidden / maintenance / offline / never-sampled / Agent
 * with stale metrics, plus 230 bulk nodes) are inserted with SQL under a
 * random prefix and removed afterwards; the site settings row is restored.
 * Requires E2E_ISOLATED_ACCOUNT=1 and a loopback test database.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

import { installDirectSession } from "./helpers/direct-session";

test.describe.configure({ mode: "serial" });

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const publicId = () => Array.from(randomBytes(12), (byte) => BASE32[byte & 31]).join("");
const prefix = `ps-e2e-${randomUUID().slice(0, 8)}`;
const BULK = 230;
const ids = {
	online: `${prefix}-online`,
	agent: `${prefix}-agent`,
	offline: `${prefix}-offline`,
	maint: `${prefix}-maint`,
	nosample: `${prefix}-nosample`,
	hidden: `${prefix}-hidden`,
	draft: `${prefix}-draft`,
};
const pid = {
	online: publicId(),
	agent: publicId(),
	offline: publicId(),
	maint: publicId(),
	nosample: publicId(),
	hidden: publicId(),
	draft: publicId(),
};
const NAMES = {
	online: `Tokyo Edge ${prefix}`,
	agent: `Frankfurt Agent ${prefix}`,
	offline: `Sydney Down ${prefix}`,
	maint: `Paris Maint ${prefix}`,
	nosample: `Lagos New ${prefix}`,
	draft: `Draft Node ${prefix}`,
};
const HOST_MARK = "198.51.100.77";

let db: Client;
let savedSite: Record<string, unknown> | null = null;

function shotDir(testInfo: TestInfo) {
	const dir = process.env.PUBLIC_STATUS_SCREENSHOT_DIR || testInfo.outputPath("shots");
	mkdirSync(dir, { recursive: true });
	return dir;
}

async function shot(page: Page, testInfo: TestInfo, name: string, fullPage = true) {
	await page.screenshot({ path: join(shotDir(testInfo), `${testInfo.project.name}-${name}.png`), fullPage });
}

async function visitor(browser: Browser, locale: "zh" | "en" = "en", theme: "dark" | "light" = "dark"): Promise<BrowserContext> {
	const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
	const url = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:3000");
	await context.addCookies([
		{ name: "vps-locale", value: locale, domain: url.hostname, path: "/" },
		{ name: "vps-theme", value: theme, domain: url.hostname, path: "/" },
	]);
	return context;
}

async function setSite(enabled: boolean) {
	await db.query(
		`INSERT INTO public_status_sites (id, enabled, title, description, announcement, "defaultView", "refreshSeconds", accent, metrics, "showPlatformStatus", "updatedAt")
		 VALUES ('default', $1, $2, $3, $4, 'cards', 15, 'indigo', ARRAY['cpu','memory','disk','network','traffic','uptime','load','latency','availability'], true, NOW())
		 ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, title = EXCLUDED.title, description = EXCLUDED.description,
		   announcement = EXCLUDED.announcement, accent = EXCLUDED.accent, metrics = EXCLUDED.metrics, "updatedAt" = NOW()`,
		[enabled, "Example Cloud Status", "Live status of our public nodes.", "Scheduled maintenance for Paris on Saturday 02:00 UTC."],
	);
}

test.beforeAll(async () => {
	const url = new URL(process.env.DATABASE_URL!);
	if (process.env.E2E_ISOLATED_ACCOUNT !== "1" || !["127.0.0.1", "localhost"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) {
		throw new Error("Isolated test database required");
	}
	db = new Client({ connectionString: url.toString() });
	await db.connect();
	const site = await db.query(`SELECT * FROM public_status_sites WHERE id = 'default'`);
	savedSite = site.rows[0] ?? null;

	const server = (id: string, mode = "DIRECT", seen: string | null = null) =>
		db.query(
			`INSERT INTO servers (id, name, host, port, username, tags, enabled, "connectionType", "managementMode", "agentLastSeenAt", "createdAt", "updatedAt")
			 VALUES ($1, $2, $3, 22, 'fixture', ARRAY[]::text[], true, 'PASSWORD', $4::"ServerManagementMode", ${seen ? `NOW() - interval '${seen}'` : "NULL"}, NOW(), NOW())`,
			[id, `internal-${id}`, HOST_MARK, mode],
		);
	for (const [key, id] of Object.entries(ids)) await server(id, key === "agent" ? "AGENT" : "DIRECT", key === "agent" ? "20 seconds" : null);

	const node = (key: keyof typeof ids, opts: { published?: boolean; maintenance?: boolean; group?: string; region?: string; tags?: string[]; sort?: number } = {}) =>
		db.query(
			`INSERT INTO public_status_nodes (id, "publicId", "serverId", published, "publishedTeamId", "displayName", "groupName", region, tags, "sortOrder", maintenance, "publishedAt", "createdAt", "updatedAt")
			 VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, NOW(), NOW(), NOW())`,
			[`${prefix}-n-${key}`, pid[key], ids[key], opts.published ?? true, NAMES[key as keyof typeof NAMES] ?? key, opts.group ?? "Asia", opts.region ?? "JP", opts.tags ?? [], opts.sort ?? 0, opts.maintenance ?? false],
		);
	await node("online", { group: "Asia", region: "Tokyo", tags: ["prod", "ipv6"], sort: -10 });
	await node("agent", { group: "Europe", region: "Frankfurt", tags: ["agent"], sort: -9 });
	await node("offline", { group: "Oceania", region: "Sydney", sort: -8 });
	await node("maint", { group: "Europe", region: "Paris", maintenance: true, sort: -7 });
	await node("nosample", { group: "Africa", region: "Lagos", sort: -6 });
	await node("draft", { published: false, group: "Asia", region: "Seoul" });

	// Latest numbers (what the sampler / Agent would have written).
	const latest = (id: string, sql: string) => db.query(`INSERT INTO server_metric_latest ("serverId", ${sql.split("|")[0]}, "updatedAt") VALUES ($1, ${sql.split("|")[1]}, NOW())`, [id]);
	const metricCols = `"checkedAt","online","metricsAt","metricsSource","intervalSeconds","cpuUsage","cpuCores","load1","load5","load15","memUsage","memUsedMb","memTotalMb","diskUsage","diskUsedBytes","diskTotalBytes","uptimeSeconds","netIface","netRxBytes","netTxBytes","rxRateBps","txRateBps","rateIntervalSeconds","periodStart","periodSince","periodRxBytes","periodTxBytes","probeAt","probeOk","probeLatencyMs"`;
	await latest(ids.online, `${metricCols}|NOW() - interval '40 seconds', true, NOW() - interval '40 seconds', 'ssh', 300, 23.5, 4, 0.42, 0.38, 0.3, 61.2, 2508, 4096, 47, 21474836480, 42949672960, 1036800, 'eth0', 9000000000, 3000000000, 1572864, 524288, 300, date_trunc('month', NOW()), date_trunc('month', NOW()), 128849018880, 32212254720, NOW() - interval '40 seconds', true, 38.4`);
	await latest(ids.agent, `${metricCols}|NOW() - interval '9 minutes', true, NOW() - interval '9 minutes', 'agent', 60, 71.0, 2, 1.8, 1.5, 1.2, 88.4, 1810, 2048, 92, 9663676416, 10737418240, 86400, 'ens3', 1000, 1000, 2048, 1024, 60, date_trunc('month', NOW()), NOW() - interval '3 days', 1073741824, 536870912, NULL, NULL, NULL`);
	await db.query(`INSERT INTO server_metric_latest ("serverId","checkedAt","online","offlineReason","metricsAt","intervalSeconds","cpuUsage","memUsage","diskUsage","probeAt","probeOk","updatedAt")
		VALUES ($1, NOW() - interval '2 minutes', false, 'unreachable', NOW() - interval '3 hours', 300, 5, 10, 20, NOW() - interval '2 minutes', false, NOW())`, [ids.offline]);
	await latest(ids.maint, `${metricCols}|NOW() - interval '1 minute', true, NOW() - interval '1 minute', 'ssh', 300, 3, 1, 0.01, 0.02, 0.03, 12, 245, 2048, 30, 3221225472, 10737418240, 360000, 'eth0', 1, 1, 100, 100, 300, date_trunc('month', NOW()), date_trunc('month', NOW()), 1048576, 1048576, NOW() - interval '1 minute', true, 120.2`);

	// History for the online node: 7 days of 5-minute samples with a 3-hour
	// outage and a sampler gap, TCP probes (some failed), interface counters.
	await db.query(
		`INSERT INTO metric_snapshots (id, "serverId", "cpuUsage", "memUsage", "diskUsage", "isOnline", "createdAt", "intervalSeconds", "probeStatus", "probeLatencyMs")
		 SELECT $1 || '-m-' || n, $2,
		   CASE WHEN n BETWEEN 300 AND 335 THEN 0 ELSE 20 + 15 * sin(n / 20.0) END,
		   CASE WHEN n BETWEEN 300 AND 335 THEN 0 ELSE 55 + 5 * cos(n / 30.0) END,
		   CASE WHEN n BETWEEN 300 AND 335 THEN 0 ELSE 45 + n / 1000.0 END,
		   NOT (n BETWEEN 300 AND 335),
		   NOW() - (n * interval '5 minutes'),
		   300,
		   CASE WHEN n BETWEEN 300 AND 335 OR n % 97 = 0 THEN 'failed' ELSE 'ok' END,
		   CASE WHEN n BETWEEN 300 AND 335 OR n % 97 = 0 THEN NULL ELSE 30 + 10 * sin(n / 7.0) END
		 FROM generate_series(1, 2016) n
		 WHERE n NOT BETWEEN 500 AND 560`,
		[prefix, ids.online],
	);
	await db.query(
		`INSERT INTO traffic_snapshots (id, source, "serverId", iface, "rxBytes", "txBytes", "rxRateBps", "txRateBps", "sampledAt")
		 SELECT $1 || '-t-' || n, 'server', $2, 'eth0',
		   CASE WHEN n > 1000 THEN (2016 - n)::bigint * 300 * 900000 + 900000000000 ELSE (2016 - n)::bigint * 300 * 900000 END,
		   (2016 - n)::bigint * 300 * 300000, 0, 0,
		   NOW() - (n * interval '5 minutes')
		 FROM generate_series(1, 2016) n`,
		[prefix, ids.online],
	);
	await db.query(
		`INSERT INTO server_uptime_snapshots (id, "serverId", date, "uptimePercent", "onlineMinutes", "offlineMinutes", "checkCount", "createdAt")
		 SELECT $1 || '-u-' || d, $2, (date_trunc('day', NOW() AT TIME ZONE 'Asia/Shanghai') - d * interval '1 day') AT TIME ZONE 'Asia/Shanghai' AT TIME ZONE 'UTC',
		   CASE WHEN d = 3 THEN 87.5 ELSE 100 END, CASE WHEN d = 3 THEN 1260 ELSE 1440 END, CASE WHEN d = 3 THEN 180 ELSE 0 END, 288, NOW()
		 FROM generate_series(1, 40) d`,
		[prefix, ids.online],
	);

	// Bulk nodes for pagination (> 200).
	await db.query(
		`INSERT INTO servers (id, name, host, port, username, tags, enabled, "connectionType", "createdAt", "updatedAt")
		 SELECT $1 || '-bulk-' || lpad(n::text, 4, '0'), 'internal-bulk-' || n, $2, 22, 'fixture', ARRAY[]::text[], true, 'PASSWORD', NOW(), NOW()
		 FROM generate_series(1, $3::int) n`,
		[prefix, HOST_MARK, BULK],
	);
	await db.query(
		`INSERT INTO public_status_nodes (id, "publicId", "serverId", published, "displayName", "groupName", region, tags, "sortOrder", "publishedAt", "createdAt", "updatedAt")
		 SELECT $1 || '-nb-' || n, translate(substr(md5($1 || n), 1, 12), '0189', 'wxyz'), $1 || '-bulk-' || lpad(n::text, 4, '0'), true,
		   'Bulk ' || lpad(n::text, 4, '0') || ' ' || $1, CASE WHEN n % 2 = 0 THEN 'Bulk A' ELSE 'Bulk B' END, 'Region ' || (n % 7), ARRAY['bulk'], n, NOW(), NOW(), NOW()
		 FROM generate_series(1, $2::int) n`,
		[prefix, BULK],
	);
	await setSite(true);
});

test.afterAll(async () => {
	if (!db) return;
	try {
		await db.query(`DELETE FROM servers WHERE id LIKE $1`, [`${prefix}%`]);
		if (savedSite) {
			await db.query(`UPDATE public_status_sites SET enabled = $1, title = $2, description = $3, announcement = $4, accent = $5, metrics = $6, "defaultView" = $7, "refreshSeconds" = $8, "showPlatformStatus" = $9 WHERE id = 'default'`, [
				savedSite.enabled, savedSite.title, savedSite.description, savedSite.announcement, savedSite.accent, savedSite.metrics, savedSite.defaultView, savedSite.refreshSeconds, savedSite.showPlatformStatus,
			]);
		} else {
			await db.query(`DELETE FROM public_status_sites WHERE id = 'default'`);
		}
	} finally {
		await db.end();
	}
});

test("visitor: root entry lands on the board, with summary, filters, views and pagination", async ({ browser }, testInfo) => {
	test.setTimeout(120_000);
	const context = await visitor(browser);
	const page = await context.newPage();
	const apiCalls: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.pathname.startsWith("/api/")) apiCalls.push(url.pathname);
	});
	await page.goto("/");
	await expect(page).toHaveURL(/\/status$/);
	await expect(page.getByRole("heading", { level: 1, name: "Example Cloud Status" })).toBeVisible();
	await expect(page.getByText("Scheduled maintenance for Paris")).toBeVisible();
	await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2F");
	await expect(page.locator("body")).not.toContainText(HOST_MARK);
	await expect(page.locator("body")).not.toContainText("internal-");

	// Narrow the board to this run's fixtures.
	const search = page.getByRole("searchbox", { name: "Search" });
	await search.fill(prefix);
	await expect(page).toHaveURL(new RegExp(`q=${prefix}`));
	await expect(page.getByText(new RegExp(`· ${BULK + 5} matching ·`))).toBeVisible();
	await expect(page.locator(`[data-public-node="${pid.hidden}"]`)).toHaveCount(0);
	await expect(page.locator(`[data-public-node="${pid.draft}"]`)).toHaveCount(0);

	const online = page.locator(`[data-public-node="${pid.online}"]`);
	await expect(online).toContainText("Online");
	await expect(online).toContainText("24%");
	await expect(online).toContainText("1.50 MiB/s");
	await expect(online).toContainText("TCP latency");
	await expect(page.locator(`[data-public-node="${pid.agent}"]`)).toContainText("metrics outdated");
	await expect(page.locator(`[data-public-node="${pid.offline}"]`)).toContainText("could not reach");
	await expect(page.locator(`[data-public-node="${pid.maint}"]`)).toContainText("Maintenance");
	await expect(page.locator(`[data-public-node="${pid.nosample}"]`)).toContainText("Not sampled yet");
	await shot(page, testInfo, "board-cards-en-dark");

	// Status filter and URL persistence.
	await page.getByLabel("Status", { exact: true }).selectOption("offline");
	await expect(page).toHaveURL(/status=offline/);
	await expect(page.locator("[data-public-node]")).toHaveCount(1);
	await page.reload();
	await expect(page.locator("[data-public-node]")).toHaveCount(1);
	await page.getByLabel("Status", { exact: true }).selectOption("all");

	// Sort by CPU descending: the agent node (71 %) first.
	await page.getByLabel("Sort", { exact: true }).selectOption("cpu");
	await page.getByRole("button", { name: /Ascending/ }).click();
	await expect(page.locator("[data-public-node]").first()).toHaveAttribute("data-public-node", pid.agent);

	// Table view persists across reloads.
	await page.getByRole("button", { name: "Table" }).click();
	await expect(page.getByRole("table", { name: "Public nodes" })).toBeVisible();
	await page.reload();
	await expect(page.getByRole("table", { name: "Public nodes" })).toBeVisible();
	await shot(page, testInfo, "board-table-en-dark");

	// Pagination beyond 200 nodes: every page reachable, last page complete.
	await page.getByLabel("Sort", { exact: true }).selectOption("default");
	await page.getByLabel("Per page", { exact: true }).selectOption("96");
	await expect(page.getByText("Page 1 of 3")).toBeVisible();
	await page.getByRole("button", { name: "Next" }).click();
	await page.getByRole("button", { name: "Next" }).click();
	await expect(page).toHaveURL(/page=3/);
	await expect(page.getByText("Page 3 of 3")).toBeVisible();
	await expect(page.locator("tbody tr[data-public-node]")).toHaveCount(BULK + 5 - 192);
	await page.reload();
	await expect(page.getByText("Page 3 of 3")).toBeVisible();

	// Group chips filter.
	await page.getByRole("button", { name: "Cards" }).click();
	await page.getByRole("group", { name: "Groups" }).getByRole("button", { name: /^Europe/ }).click();
	await expect(page).toHaveURL(/group=Europe/);
	await expect(page.locator("[data-public-node]")).toHaveCount(2);

	// No result state with a way back.
	await search.fill(`${prefix}-nothing-matches`);
	await expect(page.getByText("No node matches these filters.")).toBeVisible();
	await page.getByRole("button", { name: "Clear filters" }).click();
	await expect(page.getByText("No node matches these filters.")).toHaveCount(0);

	// The visitor page only ever called the public read API.
	expect(apiCalls.length).toBeGreaterThan(0);
	expect(apiCalls.every((path) => path.startsWith("/api/status/"))).toBe(true);
	await context.close();
});

test("visitor: node detail with history ranges, latency and the 90-day strip", async ({ browser }, testInfo) => {
	test.setTimeout(90_000);
	const context = await visitor(browser, "zh", "light");
	const page = await context.newPage();
	const loadedScripts: string[] = [];
	page.on("request", (request) => {
		if (request.resourceType() === "script") loadedScripts.push(request.url());
	});
	await page.goto(`/status/nodes/${pid.online}`);
	await expect(page.getByRole("heading", { level: 1, name: NAMES.online })).toBeVisible();
	await expect(page.getByText("控制端到节点的 TCP 连接耗时（非 ICMP Ping）")).toBeVisible();
	await expect(page.getByText("近 24 小时可用率")).toBeVisible();
	await expect(page.locator("body")).not.toContainText(HOST_MARK);
	for (const label of ["1 小时", "6 小时", "7 天", "24 小时"]) {
		await page.getByRole("button", { name: label, exact: true }).click();
		await expect(page.getByText(/每点约 \d+ 分钟 · 覆盖/)).toBeVisible();
	}
	await page.getByRole("button", { name: "7 天", exact: true }).click();
	await expect(page).toHaveURL(/range=7d/);
	await expect(page.getByRole("img", { name: "CPU / 内存 / 磁盘" })).toBeVisible();
	await expect(page.getByRole("img", { name: "网络速率" })).toBeVisible();
	await expect(page.getByRole("img", { name: "控制端到节点 TCP 延迟" })).toBeVisible();
	await expect(page.getByText(/次探测，\d+ 次失败/)).toBeVisible();
	await expect(page.getByRole("list", { name: "近 90 天每日可用率" }).locator("li")).toHaveCount(90);
	// Keyboard readout on a chart.
	await page.getByRole("img", { name: "CPU / 内存 / 磁盘" }).focus();
	await page.keyboard.press("End");
	await expect(page.locator("figcaption").first()).toContainText("%");
	await shot(page, testInfo, "node-detail-zh-light");

	// An Agent-only node reports its latency as not measured.
	await page.goto(`/status/nodes/${pid.agent}`);
	await expect(page.getByText("指标已过期").first()).toBeVisible();
	await expect(page.getByText(/未采集/).first()).toBeVisible();

	expect(loadedScripts.some((src) => /xterm|ssh-terminal|upload/i.test(src))).toBe(false);
	await context.close();
});

test("guessed, hidden and unpublished ids are a plain 404 in pages and API", async ({ browser }) => {
	const context = await visitor(browser);
	const page = await context.newPage();
	for (const id of [pid.hidden, pid.draft, publicId(), "not-an-id"]) {
		// The proxy answers before the page streams: a real 404 with the shared not-found page.
		const response = await page.goto(`/status/nodes/${id}`);
		expect(response?.status()).toBe(404);
		await expect(page.locator('meta[name="robots"][content="noindex"]').first()).toBeAttached();
		await expect(page.locator("[data-public-node-detail]")).toHaveCount(0);
		await expect(page.locator("body")).not.toContainText(prefix);
		const api = await page.request.get(`/api/status/nodes/${id}`);
		expect(api.status()).toBe(404);
		expect(api.headers()["cache-control"]).toBe("no-store");
		expect((await page.request.get(`/api/status/nodes/${id}/history?range=7d`)).status()).toBe(404);
	}
	const board = await (await page.request.get(`/api/status/board?q=${prefix}&pageSize=100`)).text();
	expect(board).not.toContain(HOST_MARK);
	expect(board).not.toMatch(/internal-|serverId|teamId|fixture/);
	await context.close();
});

test("administrator publishes and revokes a node; the visitor view follows at once", async ({ browser }, testInfo) => {
	test.setTimeout(120_000);
	const admin = await browser.newContext({ baseURL: test.info().project.use.baseURL });
	await installDirectSession(admin);
	const page = await admin.newPage();
	// Signed in: / stays the dashboard, /status adds the internal section.
	await page.goto("/");
	await expect(page).not.toHaveURL(/\/status/);
	await page.goto("/status");
	await expect(page.locator("#internal-status-title")).toBeVisible();

	await page.goto("/public-status");
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	// Type only once the list has loaded (the client is hydrated).
	await expect(page.locator("[data-admin-node]").first()).toBeVisible();
	await page.getByLabel(/搜索服务器或公开名称|Search servers or public names/).fill(`internal-${ids.draft}`);
	const row = page.locator(`[data-admin-node="${ids.draft}"]`);
	await expect(row).toBeVisible();
	await row.getByRole("button").last().click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	// The host may not be published, the name is required.
	const nameField = dialog.getByLabel(/公开名称|Public name/).first();
	await nameField.fill(`${HOST_MARK} box`);
	await dialog.getByRole("switch", { name: /在展示页公开|Show on the board/ }).click();
	await dialog.getByRole("button", { name: /^保存$|^Save$/ }).click();
	await expect(dialog.getByRole("alert")).toContainText(/主机地址|host address/);
	await nameField.fill(NAMES.draft);
	await expect(dialog.getByText(NAMES.draft).last()).toBeVisible();
	await shot(page, testInfo, "admin-edit-dialog", false);
	await dialog.getByRole("button", { name: /^保存$|^Save$/ }).click();
	await expect(dialog).toHaveCount(0);

	const guest = await visitor(browser);
	const guestPage = await guest.newPage();
	await expect.poll(async () => (await guestPage.request.get(`/api/status/nodes/${pid.draft}`)).status()).toBe(200);
	await guestPage.goto(`/status?q=${encodeURIComponent(NAMES.draft)}`);
	await expect(guestPage.locator(`[data-public-node="${pid.draft}"]`)).toBeVisible();
	await expect(guestPage.locator(`[data-public-node="${pid.draft}"]`)).toContainText("Not sampled yet");

	// Batch revoke from the management page.
	await page.reload();
	await expect(page.locator("[data-admin-node]").first()).toBeVisible();
	await page.getByLabel(/搜索服务器或公开名称|Search servers or public names/).fill(`internal-${ids.draft}`);
	await page.locator(`[data-admin-node="${ids.draft}"]`).getByRole("checkbox").check();
	await page.getByRole("button", { name: /^撤销公开$|^Unpublish$/ }).click();
	await expect.poll(async () => (await guestPage.request.get(`/api/status/nodes/${pid.draft}`)).status()).toBe(404);
	await guestPage.reload();
	await expect(guestPage.locator(`[data-public-node="${pid.draft}"]`)).toHaveCount(0);
	await shot(page, testInfo, "admin-page");
	await guest.close();
	await admin.close();
});

test("a closed board: root goes to sign-in and the public API reveals nothing", async ({ browser }) => {
	await setSite(false);
	try {
		const context = await visitor(browser);
		const page = await context.newPage();
		await page.goto("/");
		await expect(page).toHaveURL(/\/login\?next=%2F/);
		await page.goto("/status");
		await expect(page.getByText(/not public/i)).toBeVisible();
		await expect(page.locator("[data-public-node]")).toHaveCount(0);
		expect((await page.request.get("/api/status/board")).status()).toBe(404);
		expect((await page.request.get(`/api/status/nodes/${pid.online}`)).status()).toBe(404);
		// Even with ?preview=1 an anonymous visitor gets nothing.
		expect((await page.request.get("/api/status/board?preview=1")).status()).toBe(404);
		await context.close();

		// Administrators can still preview through the same projection.
		const admin = await browser.newContext({ baseURL: test.info().project.use.baseURL });
		await installDirectSession(admin);
		const adminPage = await admin.newPage();
		await adminPage.goto(`/status?preview=1&q=${prefix}`);
		await expect(adminPage.getByRole("note").filter({ hasText: /Guest preview|访客预览/ })).toBeVisible();
		await expect(adminPage.locator(`[data-public-node="${pid.online}"]`)).toBeVisible();
		await expect(adminPage.locator("#internal-status-title")).toHaveCount(0);
		await admin.close();
	} finally {
		await setSite(true);
	}
});

for (const viewport of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
	test(`responsive board and detail at ${viewport.width}px`, async ({ browser }, testInfo) => {
		for (const [locale, theme] of [["zh", "dark"], ["en", "light"]] as const) {
			const context = await visitor(browser, locale, theme);
			const page = await context.newPage();
			await page.setViewportSize(viewport);
			await page.goto(`/status?q=${prefix}&pageSize=12`);
			await expect(page.locator(`[data-public-node="${pid.online}"]`)).toBeVisible();
			const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
			expect(overflow).toBeLessThanOrEqual(1);
			await shot(page, testInfo, `board-${viewport.width}-${locale}-${theme}`);
			await page.goto(`/status/nodes/${pid.online}`);
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			await expect(page.getByRole("img").first()).toBeVisible();
			const detailOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
			expect(detailOverflow).toBeLessThanOrEqual(1);
			await shot(page, testInfo, `detail-${viewport.width}-${locale}-${theme}`);
			await context.close();
		}
	});
}

test("theme toggle and reduced motion on the public board", async ({ browser }) => {
	const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, reducedMotion: "reduce" });
	const page = await context.newPage();
	await page.goto(`/status?q=${prefix}`);
	const before = await page.evaluate(() => document.documentElement.classList.contains("light"));
	await page.getByRole("button", { name: /theme|主题|浅色|深色|Light|Dark/i }).first().click();
	await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("light"))).toBe(!before);
	await context.close();
});
