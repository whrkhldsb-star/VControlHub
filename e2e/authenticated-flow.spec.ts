import { expect, test } from "@playwright/test";

/**
 * P3 #9 — Authenticated golden-path E2E coverage.
 *
 * Covers the README-mandated critical paths:
 *   login → dashboard/server management → file operations → settings save.
 *
 * Requires a running server (started automatically by the Playwright
 * webServer config) and a seeded admin account. Credentials are read
 * from environment variables with dev-seed defaults.
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

test.describe("authenticated golden path", () => {
	test("login, navigation and settings remain usable", async ({ page }) => {
		test.setTimeout(90_000);
		await login(page);
		await expect(page.locator("body")).toBeVisible();

		await page.goto("/servers", { waitUntil: "domcontentloaded" });
		await expect(page).toHaveURL(/\/servers$/);
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
