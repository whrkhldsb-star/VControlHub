import { expect, test, type Page, type Response } from "@playwright/test";
import catalog from "../docs/route-catalog.json";
import { installDirectSession } from "./helpers/direct-session";

const TEST_USER = process.env.E2E_USER ?? "admin";
const TEST_PASS = process.env.E2E_PASS ?? "admin123";

async function login(page: Page) {
	if (process.env.E2E_DIRECT_SESSION === "1") {
		await installDirectSession(page.context());
		await page.goto("/dashboard");
		return;
	}
	await page.goto("/login");
	await page.getByLabel(/用户名|Username/i).fill(TEST_USER);
	await page.getByLabel(/密码|Password/i).fill(TEST_PASS);
	await page.getByRole("button", { name: /登录|Sign in|Log in/i }).click();
	await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

function observe(page: Page) {
	const failures: string[] = [];
	page.on("pageerror", (error) => failures.push(`pageerror ${page.url()}: ${error.message}`));
	page.on("console", (message) => {
		if (message.type() === "error" && !/favicon|ResizeObserver/i.test(message.text())) {
			failures.push(`console ${page.url()}: ${message.text()}`);
		}
	});
	page.on("response", (response: Response) => {
		if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
	});
	return failures;
}

async function gotoStable(page: Page, url: string, waitUntil: "load" | "domcontentloaded" = "load") {
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			return await page.goto(url, { waitUntil, timeout: 20_000 });
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("ERR_ABORTED") || attempt === 2) throw error;
			await page.waitForTimeout(100);
		}
	}
}

test("all concrete authenticated pages render in a real browser", async ({ page }) => {
	test.setTimeout(600_000);
	const failures = observe(page);
	await login(page);

	const paths = catalog.pages
		.map((entry) => entry.path)
		.filter((path) => !path.includes("[") && !path.startsWith("/login"))
		// Redirect-only compatibility routes are covered by their destinations.
		.filter((path) => !["/account", "/preferences", "/storage"].includes(path));
	for (const path of paths) {
		await test.step(path, async () => {
			const response = await gotoStable(page, path, "domcontentloaded");
			await page.waitForLoadState("domcontentloaded");
			expect(response?.status(), `${path} document response`).toBeLessThan(500);
			await expect(page.locator("body"), `${path} body`).toBeVisible();
			await expect(page.locator("body"), `${path} crash text`).not.toContainText(
				/Internal Server Error|Application error: a client-side exception|missing required error components/i,
			);
			expect(new URL(page.url()).pathname, `${path} unexpectedly logged out`).not.toBe("/login");
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			);
			expect(overflow, `${path} desktop horizontal overflow`).toBeLessThanOrEqual(1);
		});
	}
	expect(failures).toEqual([]);
});

test("desktop navigation and safe controls work through clicks and keyboard", async ({ page }) => {
	test.setTimeout(180_000);
	const failures = observe(page);
	await login(page);

	const visibleNavigation = page.locator('nav a[href^="/"]:visible, aside a[href^="/"]:visible');
	const hrefs = await visibleNavigation.evaluateAll((links) =>
		[...new Set(links.map((link) => link.getAttribute("href")).filter((href): href is string => Boolean(href)))],
	);
	for (const href of hrefs.slice(0, 24)) {
		await page.goto("/");
		const link = page.locator(`a[href="${href}"]:visible`).first();
		if (await link.count()) {
			await link.click();
			await page.waitForLoadState("domcontentloaded");
			await expect(page.locator("body")).toBeVisible();
		}
	}

	await page.goto("/settings");
	const tabs = page.getByRole("tab");
	for (let index = 0; index < (await tabs.count()); index += 1) {
		const tab = tabs.nth(index);
		if (await tab.isVisible()) {
			await tab.click();
			await expect(tab).toHaveAttribute("aria-selected", "true");
		}
	}

	// Exercise dialogs without confirming destructive or state-changing actions.
	for (const path of ["/users", "/downloads", "/backups", "/scheduled-tasks", "/docker"]) {
		await gotoStable(page, path);
		const trigger = page.getByRole("button", { name: /删除|重置密码|日志|详情|Delete|Reset password|Logs|Details/i }).first();
		if (await trigger.isVisible().catch(() => false)) {
			await trigger.click();
			const dialog = page.getByRole("dialog").last();
			if (await dialog.isVisible().catch(() => false)) {
				await page.keyboard.press("Escape");
				await expect(dialog).toBeHidden();
			}
		}
	}
	expect(failures).toEqual([]);
});

test("mobile layout and navigation remain operable at 390px", async ({ page }) => {
	test.setTimeout(180_000);
	const failures = observe(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await login(page);

	for (const path of ["/", "/servers", "/files", "/monitoring", "/settings", "/quick-services"]) {
		await gotoStable(page, path, "domcontentloaded");
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		);
		expect(overflow, `${path} mobile horizontal overflow`).toBeLessThanOrEqual(1);
	}

	await page.goto("/");
	const mobileNav = page.getByRole("navigation", { name: /Mobile navigation|移动端导航/i });
	const mobileLinks = mobileNav.locator('a[href^="/"]');
	expect(await mobileLinks.count(), "mobile navigation links").toBeGreaterThan(0);
	for (let index = 0; index < Math.min(await mobileLinks.count(), 5); index += 1) {
		await page.goto("/");
		const link = page.getByRole("navigation", { name: /Mobile navigation|移动端导航/i }).locator('a[href^="/"]').nth(index);
		if (await link.isVisible().catch(() => false)) await link.click();
		await expect(page.locator("body")).toBeVisible();
	}
	expect(failures).toEqual([]);
});

test("global search, language and theme controls work end to end", async ({ page }) => {
	test.setTimeout(90_000);
	const failures = observe(page);
	await login(page);

	await page.getByRole("button", { name: /全局搜索|Global search/i }).first().click();
	const dialog = page.getByRole("dialog", { name: /全局搜索|Global search/i });
	await expect(dialog).toBeVisible();
	const searchbox = dialog.getByRole("combobox");
	await searchbox.fill("设置");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await page.waitForURL(/\/settings/);

	const html = page.locator("html");
	const initialClass = (await html.getAttribute("class")) ?? "";
	await page.getByRole("button", { name: /切换到浅色模式|切换到深色模式|Switch to light|Switch to dark/i }).first().click();
	await expect.poll(async () => (await html.getAttribute("class")) ?? "").not.toBe(initialClass);

	await page.getByRole("button", { name: /切换到英文|Switch to English/i }).first().click();
	await expect(html).toHaveAttribute("lang", "en");
	await expect(page.getByRole("button", { name: /切换到中文|Switch to Chinese/i }).first()).toBeVisible();
	await page.getByRole("button", { name: /切换到中文|Switch to Chinese/i }).first().click();
	await expect(html).toHaveAttribute("lang", "zh-CN");
	expect(failures).toEqual([]);
});
