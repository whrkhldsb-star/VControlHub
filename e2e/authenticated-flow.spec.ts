import { expect, test } from "@playwright/test";

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
		await page.goto("/", { waitUntil: "domcontentloaded" });
		return;
	}
	await login(page);
}

test.describe("authenticated golden path", () => {
	test("login, navigation and settings remain usable", async ({ page, context }) => {
		test.setTimeout(90_000);
		await ensureAuthenticated(page, context);
		await expect(page.locator("body")).toBeVisible();

		await page.goto("/servers", { waitUntil: "domcontentloaded" });
		await expect(page).toHaveURL(/\/servers$/);
		await expect(page.locator("body")).not.toBeEmpty();

		await page.goto("/files", { waitUntil: "domcontentloaded" });
		await expect(page).toHaveURL(/\/files/);
		await expect(page.locator("body")).not.toBeEmpty();

		await page.goto("/settings", { waitUntil: "domcontentloaded" });
		await expect(page).toHaveURL(/\/settings$/);
		await expect(page.locator("body")).not.toBeEmpty();
		// Personal preferences auto-save; verify the interactive settings UI
		// instead of assuming a manual save button exists.
		await expect(page.getByRole("heading", { name: /默认页面|Default page/i })).toBeVisible();
		await expect(page.getByRole("switch").first()).toBeVisible();

		await page.goto("/", { waitUntil: "domcontentloaded" });
		// The authenticated chrome should expose primary navigation links.
		await expect(page.getByRole("link", { name: /设置|Settings/i }).first()).toBeVisible();
	});
});
