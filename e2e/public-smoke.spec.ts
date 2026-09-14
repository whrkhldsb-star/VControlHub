import { expect, test } from "@playwright/test";
import { getAppSlug } from "../src/lib/branding";
import { inspectDetailLayouts } from "./helpers/detail-layouts";

test.describe("public smoke routes", () => {
	test("an invalid session returns to login without a server-rendering error", async ({ page, context, baseURL }) => {
		await context.addCookies([{
			name: process.env.AUTH_SESSION_COOKIE_NAME?.trim() || `${getAppSlug()}_session`,
			value: "invalid-but-well-formed.session-signature",
			url: baseURL!, httpOnly: true, sameSite: "Lax",
		}]);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto("/servers");
		await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === "/servers");
		await expect(page.getByLabel(/用户名|Username/i)).toBeVisible();
		expect(errors).toEqual([]);
	});

	test("login page renders the authentication form", async ({ page }, testInfo) => {
		test.setTimeout(180_000);
		await page.goto("/login", { waitUntil: "domcontentloaded" });
		await expect(page.getByLabel(/用户名|Username/i)).toBeVisible();
		await expect(page.getByLabel(/密码|Password/i)).toBeVisible();
		await expect(page.getByRole("button", { name: /登录|Sign in|Log in/i })).toBeVisible();
		await inspectDetailLayouts(page, testInfo, "login");
	});

	test("public status route renders without authentication", async ({ page }, testInfo) => {
		test.setTimeout(180_000);
		await page.goto("/status", { waitUntil: "domcontentloaded" });
		await expect(page.locator("body")).toContainText(/状态|Status|健康|Health/i);
		await inspectDetailLayouts(page, testInfo, "public-status");
	});

	// Static offline shell. Keep on all browsers; the server now tolerates
	// client-disconnect "aborted" errors (src/server.ts uncaughtException guard)
	// so WebKit no longer connection-refuses mid-suite.
	test("offline route renders the offline fallback", async ({ page }, testInfo) => {
		test.setTimeout(180_000);
		await page.goto("/offline", { waitUntil: "domcontentloaded" });
		await expect(page.locator("body")).toContainText(/离线|Offline|网络|network/i);
		await inspectDetailLayouts(page, testInfo, "offline");
	});
});
