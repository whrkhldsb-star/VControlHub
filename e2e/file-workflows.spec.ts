import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";
import { loginWithCredentials } from "./helpers/login";
import { inspectDetailLayouts } from "./helpers/detail-layouts";

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

test("local file lifecycle: folder, upload, search, preview, share and delete", async ({ page, context }, testInfo) => {
	test.setTimeout(240_000);
	await login(page);
	await page.goto("/files?nodeId=node_local_default");
	await page.getByRole("button", { name: /新建文件夹|New folder/i }).click();
	await page.getByLabel(/文件夹名称|Folder name/i).fill(folder);
	await page.getByRole("button", { name: /^创建$|^Create$/i }).click();
	await expect(page.getByRole("button", { name: new RegExp(folder) }).first()).toBeVisible({ timeout: 15_000 });
	const tree = page.getByRole("heading", { name: /目录树|Directory tree/i }).locator("xpath=ancestor::aside[1]");
	if (!(await tree.isVisible())) {
		await page.getByRole("button", { name: /展开目录树|Expand directory tree/i }).click();
	}
	await tree.getByRole("button", { name: folder, exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`path=${folder}`), { timeout: 15_000 });
	const uploadSection = page.locator("[data-file-browser]");
	await expect(uploadSection).toBeVisible({ timeout: 15_000 });
	await expect(uploadSection).toContainText(folder);
	await uploadSection.getByRole("button", { name: /上传文件|Upload files/i }).click();
	const uploadDialog = page.getByRole("dialog", { name: /上传到|Upload to/i });
	await uploadDialog.locator('input[type="file"]').first().setInputFiles(path.join(process.cwd(), "e2e/fixtures/vcontrolhub-e2e.txt"));
	await expect(page.getByText("vcontrolhub-e2e.txt", { exact: true }).first()).toBeVisible();
	await uploadDialog.getByRole("button", { name: /关闭|Close/i }).click();

	await page.getByRole("checkbox", { name: /选择 vcontrolhub-e2e.txt|Select vcontrolhub-e2e.txt/i }).first().check();
	await page.getByRole("button", { name: /批量移动|Batch move/i }).click();
	await page.getByRole("button", { name: /选择目标文件夹|Choose destination folder/i }).click();
	const destinationDialog = page.getByRole("dialog", { name: /选择目标文件夹|Choose destination folder/i });
	await expect(destinationDialog).toBeVisible();
	const useFolder = destinationDialog.getByRole("button", { name: /选择此文件夹|Use this folder/i });
	await expect(useFolder).toBeEnabled({ timeout: 20_000 });
	await page.screenshot({ path: testInfo.outputPath("destination-desktop.png") });
	await page.setViewportSize({ width: 390, height: 844 });
	const pickerBox = await destinationDialog.boundingBox();
	expect(pickerBox).not.toBeNull();
	expect(pickerBox!.x).toBeGreaterThanOrEqual(0);
	expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(390);
	await page.screenshot({ path: testInfo.outputPath("destination-mobile.png") });
	await useFolder.click();
	await expect(page.getByRole("textbox", { name: /批量移动目标路径|Batch move target path/i })).toHaveValue(".");
	await page.getByRole("region", { name: /文件批量操作|File batch actions/i }).getByRole("button", { name: /取消|Cancel/i }).click();
	await page.getByRole("button", { name: /取消选择|Clear selection/i }).click();
	await page.setViewportSize({ width: 1280, height: 720 });

	const search = page.locator("#files-search-query");
	await search.fill("vcontrolhub-e2e");
	await search.press("Enter");
	await expect(page.getByText("vcontrolhub-e2e.txt", { exact: true }).first()).toBeVisible();
	await page.getByRole("button", { name: /图标视图|Grid view/i }).click();
	await page.getByRole("button", { name: /详情视图|Details view/i }).click();
	await page.getByRole("button", { name: /列表视图|List view/i }).click();

	const detailButton = page.getByRole("button", {
		name: /资料详情 vcontrolhub-e2e\.txt|File details vcontrolhub-e2e\.txt/i,
	}).first();
	await detailButton.hover();
	await detailButton.click();
	const detailDialog = page.getByRole("dialog", {
		name: "vcontrolhub-e2e.txt",
	});
	await expect(detailDialog).toBeVisible();
	await expect(detailDialog).toHaveAttribute("data-motion", "drawer");
	expect(await detailDialog.evaluate((dialog) => ({
		portalIsOnBody: dialog.parentElement?.parentElement === document.body,
		insideArticle: Boolean(dialog.closest("article")),
	}))).toEqual({ portalIsOnBody: true, insideArticle: false });
	await page.waitForTimeout(250);
	const detailPositions: string[] = [];
	for (let index = 0; index < 12; index += 1) {
		const box = await detailDialog.boundingBox();
		expect(box).not.toBeNull();
		detailPositions.push(
			`${Math.round(box!.x)}:${Math.round(box!.y)}:${Math.round(box!.width)}:${Math.round(box!.height)}`,
		);
		await page.waitForTimeout(100);
	}
	expect(new Set(detailPositions).size, `detail drawer moved: ${detailPositions.join(", ")}`).toBe(1);
	await detailDialog.getByRole("button", { name: /关闭|Close/i }).click();
	await expect(detailDialog).toBeHidden();

	await page.setViewportSize({ width: 390, height: 844 });
	await detailButton.click();
	await expect(detailDialog).toBeVisible();
	await page.waitForTimeout(250);
	const mobileBox = await detailDialog.boundingBox();
	expect(mobileBox).not.toBeNull();
	expect(Math.round(mobileBox!.x)).toBe(12);
	expect(Math.round(mobileBox!.width)).toBe(366);
	expect(Math.round(mobileBox!.height)).toBe(820);
	await detailDialog.getByRole("button", { name: /关闭|Close/i }).click();
	await page.setViewportSize({ width: 1280, height: 720 });

	const fileLink = page.getByRole("link", { name: "vcontrolhub-e2e.txt", exact: true });
	await fileLink.click();
	await expect(page).toHaveURL(/\/files\/preview/);
	await expect(page.locator("body")).toContainText("VControlHub browser E2E fixture");
	await inspectDetailLayouts(page, testInfo, "file-preview");
	await page.goto(`/files?nodeId=node_local_default&path=${encodeURIComponent(folder)}`);

	const fileRow = page.getByRole("link", { name: "vcontrolhub-e2e.txt", exact: true }).locator("xpath=ancestor::div[contains(@class,'grid-cols')][1]");
	await fileRow.getByRole("button", { name: /更多操作 vcontrolhub-e2e\.txt|More actions vcontrolhub-e2e\.txt/i }).click();
	const moreActions = page.getByRole("group", { name: /更多操作 vcontrolhub-e2e\.txt|More actions vcontrolhub-e2e\.txt/i });
	await expect(moreActions).toBeVisible();
	const shareResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/share-links") && response.request().method() === "POST");
	await moreActions.getByRole("button", { name: /^分享$|^Share$/i }).click();
	// Quick share is destructive (creates a public link), so it asks for an
	// explicit acknowledgement first. The dialog is portalled to <body>.
	const shareDialog = page.getByRole("dialog", { name: /创建临时公开分享|Create a temporary public share/i });
	await expect(shareDialog).toBeVisible();
	await shareDialog.getByRole("button", { name: /创建临时链接|Create temporary link/i }).click();
	const shareResponse = await shareResponsePromise;
	expect(shareResponse.status()).toBe(201);
	const { token } = await shareResponse.json() as { token: string };
	const shareUrl = new URL(`/share/${token}`, page.url()).toString();
	await expect(moreActions.locator("code")).toContainText(shareUrl);
	const publicPage = await context.newPage();
	await publicPage.goto(shareUrl);
	await expect(publicPage.locator("body")).toContainText("vcontrolhub-e2e.txt");
	await inspectDetailLayouts(publicPage, testInfo, "public-share");
	await expect(publicPage.locator("main")).not.toContainText(/[🔒📁📦⬇]/u);
	await expect(publicPage.getByRole("link", { name: /下载文件|Download file/i })).toHaveAttribute("download", "");
	const downloadPromise = publicPage.waitForEvent("download", { timeout: 15000 });
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
