import { expect, test, type Request } from "@playwright/test";
import catalog from "../docs/route-catalog.json";
import { installDirectSession } from "./helpers/direct-session";
import { loginWithCredentials } from "./helpers/login";

test("phone and tablet menus preserve focus, navigation and scroll after desktop resize", async ({ page }, testInfo) => {
	test.setTimeout(60_000);
	if (process.env.E2E_DIRECT_SESSION === "1") await installDirectSession(page.context());
	else await loginWithCredentials(page, process.env.E2E_USER ?? "admin", process.env.E2E_PASS ?? "admin123");
	for (const width of [320, 768]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/settings");
		const trigger = page.getByRole("button", { name: /打开导航菜单|Open navigation menu/ });
		const menu = page.getByRole("dialog", { name: /打开导航菜单|Open navigation menu/ });
		await trigger.click();
		await expect(menu).toBeVisible();
		await expect.poll(() => menu.evaluate((element) => element.contains(document.elementFromPoint(24, innerHeight - 20)))).toBe(true);
		await expect.poll(() => menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
		await page.keyboard.press("Tab");
		await expect.poll(() => menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
		await page.keyboard.press("Escape");
		await expect(menu).toBeHidden();
		await expect(trigger).toBeFocused();
		await trigger.click();
		await menu.getByRole("button", { name: /文件与传输|Files & transfer/i }).click();
		await menu.locator('a[href="/files"]').click();
		await expect(page).toHaveURL(/\/files$/);
		await expect(menu).toBeHidden();
		await page.screenshot({ path: testInfo.outputPath(`mobile-navigation-${width}.png`) });
		await trigger.click();
		await expect(menu).toBeVisible();
		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(menu).toBeHidden();
		await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
		await expect(page.locator('[data-mobile-app-header]')).toBeHidden();
	}
});

for (const width of [390, 768, 1440]) {
	test(`concrete pages fit the viewport at ${width}px`, async ({ browser, context }, testInfo) => {
		test.setTimeout(600_000);
		if (process.env.E2E_DIRECT_SESSION === "1") await installDirectSession(context);
		else {
			const loginPage = await context.newPage();
			await loginWithCredentials(loginPage, process.env.E2E_USER ?? "admin", process.env.E2E_PASS ?? "admin123");
			await loginPage.close();
		}
		const storageState = await context.storageState();
		const failures: string[] = [];
		const paths = catalog.pages.map((entry) => entry.path).filter((path) =>
			!path.includes("[") && !path.startsWith("/login") && !["/account", "/preferences", "/storage"].includes(path),
		);
		for (const path of paths) {
			await test.step(path, async () => {
				// Isolate rendering from previous routes' worker and network lifecycle.
				const routeContext = await browser.newContext({ storageState, viewport: { width, height: 900 } });
				const page = await routeContext.newPage();
				page.on("pageerror", (error) => failures.push(`${path}: ${error.message}`));
				const pendingRequests = new Set<Request>();
				let lastRequestChange = Date.now();
				page.on("request", (request) => {
					if (request.resourceType() === "eventsource") return;
					pendingRequests.add(request);
					lastRequestChange = Date.now();
				});
				const finishRequest = (request: Request) => {
					if (pendingRequests.delete(request)) lastRequestChange = Date.now();
				};
				page.on("requestfinished", finishRequest);
				page.on("requestfailed", finishRequest);
				try {
					const response = await page.goto(path, { waitUntil: "load" });
					expect.soft(response?.status(), `${path} document`).toBeLessThan(500);
					expect.soft(new URL(page.url()).pathname, `${path} authentication`).not.toBe("/login");
					await page.evaluate(() => document.fonts.ready);
					// Wait for hydration/prefetch without waiting for persistent SSE streams.
					await expect.poll(() => pendingRequests.size
						? [...pendingRequests].map((request) => `${request.resourceType()} ${request.url()}`)
						: Date.now() - lastRequestChange < 500 ? ["settling"] : [], {
						// Server cards allow 20s for diagnostics before showing offline status.
						timeout: 30_000,
						message: `${path} finite requests should settle before measuring layout`,
					}).toEqual([]);
					const dimensions = await page.evaluate(() => ({
						width: document.documentElement.clientWidth,
						scroll: document.documentElement.scrollWidth,
					}));
					expect.soft(dimensions.scroll - dimensions.width, `${path} horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
					if (["/", "/files", "/shares", "/settings", "/audit", "/servers"].includes(path)) {
						await page.screenshot({ path: testInfo.outputPath(`${path.slice(1) || "dashboard"}-${width}.png`) });
					}
				} finally {
					await routeContext.close();
				}
			});
		}
		expect(failures).toEqual([]);
	});
}

test("share picker preserves a usable filename column on narrow phones", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 320, height: 844 });
	if (process.env.E2E_DIRECT_SESSION === "1") await installDirectSession(page.context());
	else await loginWithCredentials(page, process.env.E2E_USER ?? "admin", process.env.E2E_PASS ?? "admin123");
	await page.route("**/api/files/list?**", async (route) => {
		const nodeId = new URL(route.request().url()).searchParams.get("nodeId");
		await route.fulfill({ json: {
			currentPath: "", nodeIdFilter: nodeId, folders: [], nodes: [],
			files: [{ id: "layout-file", name: "inspection-report.txt", relativePath: "inspection-report.txt", storageNodeId: nodeId, entryType: "FILE", sizeLabel: "1 KB" }],
		} });
	});
	await page.goto("/shares");
	const name = page.getByText("inspection-report.txt", { exact: true });
	await expect(name).toBeVisible();
	expect((await name.boundingBox())?.width).toBeGreaterThan(50);
	await name.scrollIntoViewIfNeeded();
	await page.screenshot({ path: testInfo.outputPath("shares-320.png") });
});
