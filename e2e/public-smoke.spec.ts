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

	test("offline route renders the offline fallback", async ({ page }) => {
		// Static offline shell — use networkidle-avoiding load + soft retry.
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const res = await page.goto("/offline", { waitUntil: "domcontentloaded", timeout: 15_000 });
				if (res && res.ok()) break;
			} catch {
				if (attempt === 2) throw new Error("offline route unreachable after retries");
				await page.waitForTimeout(1000);
			}
		}
		await expect(page.locator("body")).toContainText(/离线|Offline|网络|network/i);
	});
});
