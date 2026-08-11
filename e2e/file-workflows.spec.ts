import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";
import { loginWithCredentials } from "./helpers/login";

const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "admin123";
const folder = `qa-files-${Date.now()}`;

async function login(page: Page) {
	if (process.env.E2E_DIRECT_SESSION === "1") {
		await installDirectSession(page.context());
		await page.goto("/dashboard");
		return;
	}
	await loginWithCredentials(page, USER, PASS);
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
	const currentDirectory = page.getByRole("heading", { name: /当前目录操作|Current directory actions/i });
	await expect(currentDirectory).toBeVisible({ timeout: 15_000 });
	await expect(currentDirectory.locator("xpath=ancestor::article[1]")).toContainText(folder);

	const uploadSection = currentDirectory.locator("xpath=ancestor::article[1]");
	await uploadSection.getByRole("button", { name: /上传文件|Upload files/i }).click();
	const uploadDialog = page.getByRole("dialog", { name: /上传到|Upload to/i });
	await uploadDialog.locator('input[type="file"]').first().setInputFiles(path.join(process.cwd(), "e2e/fixtures/vcontrolhub-e2e.txt"));
	await expect(page.getByText("vcontrolhub-e2e.txt", { exact: true }).first()).toBeVisible();
	await uploadDialog.getByRole("button", { name: /关闭|Close/i }).click();

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
	const moreActions = page.getByRole("group", { name: /更多操作 vcontrolhub-e2e\.txt|More actions vcontrolhub-e2e\.txt/i });
	await expect(moreActions).toBeVisible();
	const shareResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/share-links") && response.request().method() === "POST");
	await moreActions.getByRole("button", { name: /分享|Share/i }).click();
	const shareResponse = await shareResponsePromise;
	expect(shareResponse.status()).toBe(201);
	const { token } = await shareResponse.json() as { token: string };
	const shareUrl = new URL(`/share/${token}`, page.url()).toString();
	await expect(moreActions.locator("code")).toContainText(shareUrl);
	const publicPage = await context.newPage();
	await publicPage.goto(shareUrl);
	await expect(publicPage.locator("body")).toContainText("vcontrolhub-e2e.txt");
	await expect(publicPage.locator("main")).not.toContainText(/[🔒📁📦⬇]/u);
	const downloadPromise = publicPage.waitForEvent("download");
	await publicPage.getByRole("link", { name: /下载文件|Download file/i }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe("vcontrolhub-e2e.txt");
	expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
	await publicPage.close();
	await moreActions.getByRole("button", { name: /关闭|Close/i }).click();

	if (!(await moreActions.isVisible().catch(() => false))) {
		await fileRow.getByRole("button", { name: /更多操作 vcontrolhub-e2e\.txt|More actions vcontrolhub-e2e\.txt/i }).click();
	}
	await moreActions.getByRole("button", { name: /删除|Delete/i }).click();
	await moreActions.getByRole("button", { name: /^确认$|^Confirm$/i }).click();
	await expect(page.getByRole("link", { name: "vcontrolhub-e2e.txt", exact: true })).toBeHidden();
});
