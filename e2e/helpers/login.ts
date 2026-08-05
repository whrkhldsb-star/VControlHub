import type { Page } from "@playwright/test";

export async function loginWithCredentials(
	page: Page,
	username: string,
	password: string,
) {
	await page.goto("/login");
	await page.getByLabel(/用户名|Username/i).fill(username);
	await page.getByLabel(/密码|Password/i).fill(password);
	await Promise.all([
		page.waitForURL(
			(url) =>
				!url.pathname.startsWith("/login") || url.searchParams.has("error"),
			{ timeout: 15_000 },
		),
		page.getByRole("button", { name: /登录|Sign in|Log in/i }).click(),
	]);
	const current = new URL(page.url());
	if (current.pathname.startsWith("/login")) {
		const reason = current.searchParams.get("error") || "authentication incomplete";
		throw new Error(`E2E login failed: ${reason}`);
	}
}
