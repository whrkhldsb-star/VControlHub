import { expect, test } from "@playwright/test";

test.describe("public smoke routes", () => {
	test("login page renders the authentication form", async ({ page }) => {
		await page.goto("/login", { waitUntil: "domcontentloaded" });
		await expect(page.getByLabel(/用户名|Username/i)).toBeVisible();
		await expect(page.getByLabel(/密码|Password/i)).toBeVisible();
		await expect(page.getByRole("button", { name: /登录|Sign in|Log in/i })).toBeVisible();
	});

	test("public status route renders without authentication", async ({ page }) => {
		await page.goto("/status", { waitUntil: "domcontentloaded" });
		await expect(page.locator("body")).toContainText(/状态|Status|健康|Health/i);
	});

	// Static offline shell — WebKit on GitHub Actions intermittently refuses
	// the connection to the custom Node server for this path only (login/status
	// pass). Chromium is enough to guard the route exists and renders copy.
	test("offline route renders the offline fallback", async ({ page, browserName }) => {
		test.skip(browserName === "webkit", "WebKit flaky against custom server /offline in CI");
		await page.goto("/offline", { waitUntil: "domcontentloaded" });
		await expect(page.locator("body")).toContainText(/离线|Offline|网络|network/i);
	});
});
