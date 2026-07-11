import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";

const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "admin123";
const filename = `qa-image-${Date.now()}.png`;

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

test("media image upload, search, favorite, tag, detail and image-bed publish", async ({ page }) => {
	test.setTimeout(120_000);
	await login(page);
	await page.goto("/media?type=image");
	const panel = page.getByRole("heading", { name: /图片图床工作区|Image.*workspace/i }).locator("xpath=ancestor::section[1]");
	await panel.getByRole("button", { name: /加载存储节点|Load storage nodes/i }).click();
	await panel.getByLabel(/存储节点|Storage node/i).selectOption("node_local_default");
	await panel.getByLabel(/上传到存储目录|Target path/i).fill("qa-media");
	const buffer = await readFile(path.join(process.cwd(), "public/icon-192x192.png"));
	await panel.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: "image/png", buffer });
	await expect(panel.getByRole("status").last()).toContainText(/上传完成|Upload completed/i, { timeout: 30_000 });
	await page.getByRole("button", { name: /扫描媒体索引|Scan media index/i }).click();
	await expect(page.getByRole("status").last()).toBeVisible({ timeout: 30_000 });

	await page.getByRole("searchbox", { name: /搜索媒体|Search media/i }).fill(filename);
	await page.getByRole("button", { name: /^搜索$|^Search$/i }).click();
	const card = page.getByRole("link", { name: new RegExp(`${filename}.*(?:预览|preview)`, "i") }).first().locator("xpath=ancestor::div[contains(concat(' ',normalize-space(@class),' '),' group ')][1]");
	await expect(card).toBeVisible();
	await card.getByRole("button", { name: /收藏|Favorite/i }).click();
	await card.getByRole("button", { name: /添加标签|Add tag/i }).click();
	await card.getByLabel(/新标签|New tag/i).fill("qa-e2e");
	await card.getByLabel(/新标签|New tag/i).press("Enter");
	await expect(card.getByText("#qa-e2e")).toBeVisible();

	const detail = card.getByRole("link", { name: new RegExp(`${filename}.*预览|${filename}.*preview`, "i") }).first();
	await detail.click();
	await expect(page).toHaveURL(/\/media\/[^/]+$/);
	await expect(page.locator("body")).toContainText(filename);
	await page.goBack();

	const refreshedCard = page.getByRole("link", { name: new RegExp(`${filename}.*(?:预览|preview)`, "i") }).first().locator("xpath=ancestor::div[contains(concat(' ',normalize-space(@class),' '),' group ')][1]");
	await refreshedCard.getByRole("button", { name: /图床外链|Image bed/i }).click();
	await expect(refreshedCard.getByRole("link", { name: /https?:\/\//i })).toBeVisible({ timeout: 20_000 });
});

test("image-bed search, preview, copy controls and delete isolated image", async ({ page }) => {
	await login(page);
	await page.goto("/image-bed");
	await page.getByRole("searchbox", { name: /图片搜索|Image search/i }).fill(filename);
	await page.getByRole("button", { name: /^搜索$|^Search$/i }).click();
	await expect(page.getByText(filename, { exact: true })).toBeVisible();
	const imageCard = page.getByText(filename, { exact: true }).locator("xpath=ancestor::div[.//*[@data-testid='image-card-overlay']][1]");
	await imageCard.getByTestId("image-card-overlay").click({ position: { x: 8, y: 8 } });
	const dialog = page.getByRole("dialog");
	await expect(dialog).toContainText(filename);
	await dialog.getByRole("button", { name: /复制外链|Copy URL/i }).click();
	await dialog.getByRole("button", { name: /关闭|Close/i }).click();
	await page.getByRole("button", { name: /删除(?:图片)?|Delete image/i }).click();
	await page.getByRole("dialog", { name: /确认删除图片|Delete image/i }).getByRole("button", { name: /确认删除|Confirm delete/i }).click();
	await expect(page.getByText(filename, { exact: true })).toBeHidden();
});
