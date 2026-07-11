import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";

const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "admin123";
const folder = `qa-files-${Date.now()}`;

async function login(page: Page) {
	if (process.env.E2E_DIRECT_SESSION === "1") {
		await installDirectSession(page.context());
		await page.goto("/dashboard");
		return;
	}
	await page.goto("/login");
	await page.getByLabel(/用户名|Username/i).fill(USER);
	await page.getByLabel(/密码|Password/i).fill(PASS);
	await page.getByRole("button", { name: /登录|Sign in|Log in/i }).click();
	await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("local file lifecycle: folder, upload, search, preview, share and delete", async ({ page, context }) => {
	test.setTimeout(120_000);
	await login(page);
	await page.goto("/files?nodeId=node_local_default");
	await page.getByRole("button", { name: /新建文件夹|New folder/i }).click();
	await page.getByLabel(/文件夹名称|Folder name/i).fill(folder);
	await page.getByRole("button", { name: /^创建$|^Create$/i }).click();
	await expect(page.getByRole("button", { name: new RegExp(folder) }).first()).toBeVisible({ timeout: 15_000 });
	const tree = page.getByRole("heading", { name: /目录树|Directory tree/i }).locator("xpath=ancestor::aside[1]");
	await tree.getByRole("button", { name: folder, exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`path=${folder}`), { timeout: 15_000 });
	await expect(page.getByRole("heading", { name: new RegExp(folder) })).toBeVisible({ timeout: 15_000 });

	const uploadSection = page.getByRole("heading", { name: new RegExp(folder) }).locator("xpath=ancestor::section[1]");
	await uploadSection.locator('input[type="file"]').first().setInputFiles(path.join(process.cwd(), "e2e/fixtures/vcontrolhub-e2e.txt"));
	await expect(page.getByText("vcontrolhub-e2e.txt", { exact: true }).first()).toBeVisible();

	const search = page.getByRole("searchbox").first();
	await search.fill("vcontrolhub-e2e");
	await search.press("Enter");
	await expect(page.getByText("vcontrolhub-e2e.txt", { exact: true }).first()).toBeVisible();
	await page.getByRole("button", { name: /图标视图|Grid view/i }).click();
	await page.getByRole("button", { name: /详情视图|Details view/i }).click();
	await page.getByRole("button", { name: /列表视图|List view/i }).click();

	const fileLink = page.getByRole("link", { name: "vcontrolhub-e2e.txt", exact: true });
	await fileLink.click();
	await expect(page).toHaveURL(/\/files\/preview/);
	await expect(page.locator("body")).toContainText("VControlHub browser E2E fixture");
	await page.goto(`/files?nodeId=node_local_default&path=${encodeURIComponent(folder)}`);

	const fileRow = page.getByRole("link", { name: "vcontrolhub-e2e.txt", exact: true }).locator("xpath=ancestor::div[contains(@class,'grid-cols')][1]");
	await fileRow.getByRole("button", { name: /更多操作 vcontrolhub-e2e\.txt|More actions vcontrolhub-e2e\.txt/i }).click();
	const shareResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/share-links") && response.request().method() === "POST");
	await fileRow.getByRole("button", { name: /分享|Share/i }).click();
	const shareResponse = await shareResponsePromise;
	expect(shareResponse.status()).toBe(201);
	const { token } = await shareResponse.json() as { token: string };
	const shareUrl = new URL(`/share/${token}`, page.url()).toString();
	await expect(fileRow.locator("code")).toContainText(shareUrl);
	const publicPage = await context.newPage();
	await publicPage.goto(shareUrl);
	await expect(publicPage.locator("body")).toContainText("vcontrolhub-e2e.txt");
	await publicPage.close();
	await fileRow.getByRole("button", { name: /关闭|Close/i }).click();

	const moreMenu = fileRow.locator("details");
	if (!(await moreMenu.evaluate((element) => element.hasAttribute("open")))) {
		await fileRow.getByRole("button", { name: /更多操作 vcontrolhub-e2e\.txt|More actions vcontrolhub-e2e\.txt/i }).click();
	}
	await fileRow.getByRole("button", { name: /删除|Delete/i }).click();
	await fileRow.getByRole("button", { name: /^确认$|^Confirm$/i }).click();
	await expect(page.getByRole("link", { name: "vcontrolhub-e2e.txt", exact: true })).toBeHidden();
});
