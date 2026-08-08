import { expect, test, type Page } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";
import { loginWithCredentials } from "./helpers/login";

const TEST_USER = process.env.E2E_USER ?? "admin";
const TEST_PASS = process.env.E2E_PASS ?? "admin123";

async function login(page: Page) {
	if (process.env.E2E_DIRECT_SESSION === "1") {
		await installDirectSession(page.context());
		await page.goto("/dashboard");
		return;
	}
	await loginWithCredentials(page, TEST_USER, TEST_PASS);
}

test("core pages have no browser crashes, HTTP 5xx, or horizontal overflow", async ({ page }) => {
	test.setTimeout(120_000);
	const failures: string[] = [];
	page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
	page.on("response", (response) => {
		if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
	});

	await login(page);
	for (const pathname of ["/", "/servers", "/files", "/settings", "/monitoring", "/traffic", "/docker"]) {
		await page.goto(pathname, { waitUntil: "domcontentloaded" });
		await expect(page).toHaveURL(new RegExp(`${pathname === "/" ? "/$" : `${pathname}$`}`));
		await expect(page.locator("body")).toBeVisible();
	}

	await page.setViewportSize({ width: 390, height: 844 });
	for (const pathname of ["/", "/servers", "/settings"]) {
		await page.goto(pathname, { waitUntil: "domcontentloaded" });
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		expect(overflow, `${pathname} horizontally overflows on mobile`).toBeLessThanOrEqual(1);
	}

	expect(failures).toEqual([]);
});

test("login form is fully operable with the keyboard", async ({ page }) => {
	await page.goto("/login");
	await page.keyboard.press("Tab");
	await expect(page.getByLabel(/用户名|Username/i)).toBeFocused();
	await page.keyboard.type(TEST_USER);
	await page.keyboard.press("Tab");
	await expect(page.getByLabel(/密码|Password/i)).toBeFocused();
	await page.keyboard.type(TEST_PASS);
	await page.keyboard.press("Enter");
	await page.waitForURL((url) => !url.pathname.startsWith("/login"));
});
