import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";
import { loginWithCredentials } from "./helpers/login";
import { inspectDetailLayouts } from "./helpers/detail-layouts";

const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "admin123";
const folder = `qa-files-${Date.now()}`;
const fileName = "vcontrolhub-e2e.txt";

async function login(page: Page) {
	if (process.env.E2E_DIRECT_SESSION === "1") {
		await installDirectSession(page.context());
		await page.goto("/dashboard");
		return;
	}
	await loginWithCredentials(page, USER, PASS);
}

/** Open the entry's "more" menu (the same menu as its right-click). */
async function openMore(page: Page, name: string) {
	await page.getByRole("button", { name: new RegExp(`^(?:更多操作|More actions) ${name.replace(/\./g, "\\.")}$`) }).first().click();
	const menu = page.getByRole("menu", { name: new RegExp(`(?:更多操作|More actions) ${name.replace(/\./g, "\\.")}`) });
	await expect(menu).toBeVisible();
	return menu;
}

test("local file lifecycle: folder, upload, search, preview, share and delete", async ({ page, context }, testInfo) => {
	test.setTimeout(240_000);
	await login(page);
	await page.goto("/files?nodeId=node_local_default");
	const drive = page.locator("[data-file-browser]");
	await expect(drive).toBeVisible({ timeout: 15_000 });

	// New folder: a dialog, not an inline form in the toolbar.
	await drive.getByRole("button", { name: /新建文件夹|New folder/i }).click();
	const newFolder = page.getByRole("dialog", { name: /新建文件夹|New folder/i });
	await newFolder.getByLabel(/文件夹名称|Folder name/i).fill(folder);
	await newFolder.getByRole("button", { name: /^创建$|^Create$/i }).click();
	await expect(newFolder).toBeHidden({ timeout: 15_000 });
	await expect(drive.getByRole("link", { name: folder, exact: true })).toBeVisible({ timeout: 15_000 });

	const tree = page.getByRole("heading", { name: /目录树|Directory tree/i }).locator("xpath=ancestor::aside[1]");
	if (!(await tree.isVisible())) {
		await page.getByRole("button", { name: /展开目录树|Expand directory tree/i }).click();
	}
	await tree.getByRole("button", { name: folder, exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`path=${folder}`), { timeout: 15_000 });
	await expect(drive.getByRole("navigation", { name: /面包屑|Breadcrumb/i })).toContainText(folder);

	// Upload goes straight into the open folder through the file chooser.
	await drive.getByRole("button", { name: /^(?:上传|Upload)$/i }).click();
	const chooserPromise = page.waitForEvent("filechooser");
	await page.getByRole("menuitem", { name: /^(?:上传文件|Upload files)$/i }).click();
	const chooser = await chooserPromise;
	await chooser.setFiles(path.join(process.cwd(), "e2e/fixtures/vcontrolhub-e2e.txt"));
	await expect(page.getByRole("region", { name: /上传任务|Uploads/i })).toBeVisible();
	await expect(drive.getByRole("link", { name: fileName, exact: true })).toBeVisible({ timeout: 30_000 });

	// Selecting shows the selection bar; moving opens a folder browser.
	await page.getByRole("checkbox", { name: new RegExp(`(?:选择|Select) ${fileName}`) }).check();
	const bar = page.getByRole("region", { name: /文件批量操作|File batch actions/i });
	await expect(bar).toContainText(/已选 1 项|1 selected/);
	await bar.getByRole("button", { name: /移动到…|Move to…/i }).click();
	const moveDialog = page.getByRole("dialog", { name: /^(?:移动到|Move to)$/i });
	await expect(moveDialog).toBeVisible();
	// The file already sits in the folder the browser opens on.
	await expect(moveDialog.getByRole("button", { name: /移动到此处|Move here/i })).toBeDisabled({ timeout: 20_000 });
	await moveDialog.getByRole("button", { name: /返回上一层|Go up one level/i }).click();
	await expect(moveDialog.getByRole("button", { name: /移动到此处|Move here/i })).toBeEnabled({ timeout: 20_000 });
	await page.screenshot({ path: testInfo.outputPath("destination-desktop.png") });
	await page.setViewportSize({ width: 390, height: 844 });
	const pickerBox = await moveDialog.boundingBox();
	expect(pickerBox).not.toBeNull();
	expect(pickerBox!.x).toBeGreaterThanOrEqual(0);
	expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(390);
	await page.screenshot({ path: testInfo.outputPath("destination-mobile.png") });
	await moveDialog.getByRole("button", { name: /^(?:取消|Cancel)$/i }).click();
	await bar.getByRole("button", { name: /取消选择|Clear selection/i }).click();
	await expect(bar).toBeHidden();
	await page.setViewportSize({ width: 1280, height: 720 });

	const search = page.locator("#files-search-query");
	await search.fill("vcontrolhub-e2e");
	await search.press("Enter");
	await expect(drive.getByRole("link", { name: fileName, exact: true })).toBeVisible();
	await page.getByRole("button", { name: /图标视图|Grid view|Icon view/i }).click();
	await expect(page.getByTestId("file-card").first()).toBeVisible();
	await page.getByRole("button", { name: /列表视图|List view/i }).click();
	await expect(page.getByTestId("file-table")).toBeVisible();

	// Details: a right-hand drawer that stays put, edge to edge on phones.
	await (await openMore(page, fileName)).getByRole("menuitem", { name: /资料详情|File details/i }).click();
	const detailDialog = page.getByRole("dialog", { name: fileName });
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
		detailPositions.push(`${Math.round(box!.x)}:${Math.round(box!.y)}:${Math.round(box!.width)}:${Math.round(box!.height)}`);
		await page.waitForTimeout(100);
	}
	expect(new Set(detailPositions).size, `detail drawer moved: ${detailPositions.join(", ")}`).toBe(1);
	await detailDialog.getByRole("button", { name: /关闭|Close/i }).click();
	await expect(detailDialog).toBeHidden();

	await page.setViewportSize({ width: 390, height: 844 });
	await (await openMore(page, fileName)).getByRole("menuitem", { name: /资料详情|File details/i }).click();
	await expect(detailDialog).toBeVisible();
	await page.waitForTimeout(250);
	const mobileBox = await detailDialog.boundingBox();
	expect(mobileBox).not.toBeNull();
	// Drawer overlays are edge-to-edge on phones (p-0, sm:p-3) since the
	// design-system rebuild: the panel spans the full viewport width.
	expect(Math.round(mobileBox!.x)).toBe(0);
	expect(Math.round(mobileBox!.width)).toBe(390);
	expect(Math.round(mobileBox!.height)).toBe(844);
	await detailDialog.getByRole("button", { name: /关闭|Close/i }).click();
	await page.setViewportSize({ width: 1280, height: 720 });

	// Text files open on the preview page; its back button returns to this folder.
	await drive.getByRole("link", { name: fileName, exact: true }).click();
	await expect(page).toHaveURL(/\/files\/preview/);
	await expect(page.locator("body")).toContainText("VControlHub browser E2E fixture");
	await inspectDetailLayouts(page, testInfo, "file-preview");
	await page.getByRole("link", { name: /返回文件|Back to files/i }).click();
	await expect(page).toHaveURL(new RegExp(`path=${folder}`), { timeout: 15_000 });

	const shareResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/share-links") && response.request().method() === "POST");
	await (await openMore(page, fileName)).getByRole("menuitem", { name: /^分享$|^Share$/i }).click();
	// Quick share creates a public link, so it asks for an explicit acknowledgement first.
	const shareDialog = page.getByRole("dialog", { name: /创建临时公开分享|Create a temporary public share/i });
	await expect(shareDialog).toBeVisible();
	await shareDialog.getByRole("button", { name: /创建临时链接|Create temporary link/i }).click();
	const shareResponse = await shareResponsePromise;
	expect(shareResponse.status()).toBe(201);
	const { token } = await shareResponse.json() as { token: string };
	const shareUrl = new URL(`/share/${token}`, page.url()).toString();
	await expect(shareDialog.locator("code")).toContainText(shareUrl);
	const publicPage = await context.newPage();
	await publicPage.goto(shareUrl);
	await expect(publicPage.locator("body")).toContainText(fileName);
	await inspectDetailLayouts(publicPage, testInfo, "public-share");
	await expect(publicPage.locator("main")).not.toContainText(/[🔒📁📦⬇]/u);
	await expect(publicPage.getByRole("link", { name: /下载文件|Download file/i })).toHaveAttribute("download", "");
	const downloadPromise = publicPage.waitForEvent("download", { timeout: 15000 });
	await publicPage.getByRole("link", { name: /下载文件|Download file/i }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe(fileName);
	expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
	await publicPage.close();
	await shareDialog.getByRole("button", { name: /^完成$|^Done$/i }).click();
	await expect(shareDialog).toBeHidden();

	await (await openMore(page, fileName)).getByRole("menuitem", { name: /^删除$|^Delete$/i }).click();
	const deleteDialog = page.getByRole("dialog", { name: /删除|Delete/i });
	await expect(deleteDialog).toBeVisible();
	await deleteDialog.getByRole("button", { name: /^确认$|^Confirm$/i }).click();
	await expect(drive.getByRole("link", { name: fileName, exact: true })).toBeHidden({ timeout: 15_000 });
});
