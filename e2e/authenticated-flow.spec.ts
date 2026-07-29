import { expect, test, type Page, type Response } from "@playwright/test";

import { installDirectSession } from "./helpers/direct-session";

/**
 * Authenticated golden-path smoke.
 *
 * Covers: login/session → servers → files → settings → dashboard chrome.
 * Prefer direct session minting when E2E_DIRECT_SESSION=1 (CI) so we do not
 * depend on seed admin still being in PENDING_PASSWORD_RESET / form login.
 * Form login remains as a local fallback.
 */
const TEST_USER = process.env.E2E_USER ?? "admin";
const TEST_PASS = process.env.E2E_PASS ?? "admin123";

async function login(page: import("@playwright/test").Page) {
	await page.goto("/login");
	await page.getByLabel(/用户名|Username/i).fill(TEST_USER);
	await page.getByLabel(/密码|Password/i).fill(TEST_PASS);
	await Promise.all([
		page.waitForURL((url) => !url.pathname.startsWith("/login")),
		page.getByRole("button", { name: /登录|Sign in|Log in/i }).click(),
	]);
}

async function ensureAuthenticated(
	page: import("@playwright/test").Page,
	context: import("@playwright/test").BrowserContext,
) {
	if (process.env.E2E_DIRECT_SESSION === "1") {
		await installDirectSession(context);
		const dashboardBootstrap = Promise.all(
			["/api/dashboard/analytics", "/api/preferences", "/api/notifications"].map(
				(pathname) =>
					page.waitForResponse((response) => {
						const url = new URL(response.url());
						return url.pathname === pathname && response.ok();
					}),
			),
		);
		await page.goto("/", { waitUntil: "networkidle" });
		await dashboardBootstrap;
		await page.evaluate(async () => {
			if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
		});
		return;
	}
	await login(page);
}

async function navigateThroughApp(page: Page, href: string) {
	const groupByRoute: Record<string, RegExp> = {
		"/dashboard": /总览与监控|Overview(?: and monitoring)?/i,
		"/servers": /总览与监控|Overview(?: and monitoring)?/i,
		"/files": /文件与传输|Files(?: and transfer)?/i,
		"/settings": /配置|Configuration|Settings/i,
	};
	const link = page.locator(`a[href="${href}"]:visible`).first();
	if (await link.count() === 0) {
		const groupName = groupByRoute[href];
		if (!groupName) throw new Error(`No navigation group configured for ${href}`);
		await page.getByRole("button", { name: groupName }).filter({ visible: true }).first().click();
	}
	await Promise.all([
		page.waitForURL((url) => url.pathname === href),
		link.click(),
	]);
	await page.waitForLoadState("networkidle");
}

function observeRuntimeFailures(page: Page) {
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

test.describe("authenticated golden path", () => {
	test("login, navigation and settings remain usable", async ({ page, context }) => {
		test.setTimeout(90_000);
		const runtimeFailures = observeRuntimeFailures(page);
		await ensureAuthenticated(page, context);
		await expect(page.locator("body")).toBeVisible();

		await navigateThroughApp(page, "/servers");
		await expect(page).toHaveURL(/\/servers$/);
		await expect(page.locator("body")).not.toBeEmpty();

		await navigateThroughApp(page, "/files");
		await expect(page).toHaveURL(/\/files/);
		await expect(page.locator("body")).not.toBeEmpty();

		await navigateThroughApp(page, "/settings");
		await expect(page).toHaveURL(/\/settings$/);
		await expect(page.locator("body")).not.toBeEmpty();
		// Personal preferences auto-save; verify the interactive settings UI
		// instead of assuming a manual save button exists.
		await expect(page.getByRole("heading", { name: /默认页面|Default page/i })).toBeVisible();
		await expect(page.getByRole("switch").first()).toBeVisible();

		await navigateThroughApp(page, "/dashboard");
		// The authenticated chrome should expose primary navigation links.
		await expect(page.getByRole("link", { name: /设置|Settings/i }).first()).toBeVisible();
		expect(runtimeFailures).toEqual([]);
	});
});
