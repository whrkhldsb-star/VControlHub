import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";
import { loginWithCredentials } from "./helpers/login";
import type { ImageItem } from "../src/app/image-bed/image-bed-types";
import { inspectDetailLayouts } from "./helpers/detail-layouts";

const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "admin123";
const filename = `qa-image-${Date.now()}.png`;
// Network fixtures must bypass Service Worker interception, including WebKit.
const previewTest = test.extend({ serviceWorkers: "block" });

async function login(page: Page) {
	if (process.env.E2E_DIRECT_SESSION === "1") {
		await installDirectSession(page.context());
		await page.goto("/dashboard");
		return;
	}
	await loginWithCredentials(page, USER, PASS);
}

test("media image upload, search, favorite, tag, detail and image-bed publish", async ({ page }, testInfo) => {
	test.setTimeout(180_000);
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
	await inspectDetailLayouts(page, testInfo, "media-detail");
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
	await page.getByRole("button", { name: filename, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toContainText(filename);
	await dialog.getByRole("button", { name: /复制外链|Copy URL|Copy link/i }).click();
	await dialog.getByRole("button", { name: /关闭|Close/i }).click();
	await page.getByRole("button", { name: /删除(?:图片)?|Delete image/i }).click();
	await page.getByRole("dialog", { name: /确认删除图片|Delete image/i }).getByRole("button", { name: /确认删除|Confirm delete/i }).click();
	await expect(page.getByText(filename, { exact: true })).toBeHidden();
});

previewTest("image previews preserve decoded aspect ratios and accessible controls across viewport sizes", async ({ page, context, baseURL }, testInfo) => {
	test.setTimeout(120_000);
	// Present a browser without Service Worker support instead of producing a
	// registration-error toast solely because this fixture blocks registration.
	await context.addInitScript(() => {
		Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
	});
	await login(page);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const bitmap = await readFile(path.join(process.cwd(), "public/icon-192x192.png"));
	const dimensions = [[192, 192], [1600, 400], [400, 1600]] as const;
	const images: ImageItem[] = [];
	for (const [index, [width, height]] of dimensions.entries()) {
		const publicUrl = `/api/images/preview-fixture-${index}/file`;
		const bytes = await sharp(bitmap).resize(width, height, { fit: "fill" }).png().toBuffer();
		await page.route(`**${publicUrl}`, (route) => route.fulfill({ contentType: "image/png", body: bytes }));
		images.push({
			id: `preview-fixture-${index}`,
			filename: `preview-${index}-${"long-image-name-".repeat(6)}.png`,
			mimeType: "image/png", sizeBytes: bytes.length,
			width: index === 0 ? null : width, height: index === 0 ? null : height,
			album: null, isPublic: false, createdAt: "2026-01-01T00:00:00Z", publicUrl,
		});
	}
	await page.route("**/api/images/list?**", (route) => route.fulfill({
		json: { images, total: images.length, totalPages: 1, page: 1 },
	}));
	for (const [theme, locale] of [["light", "en"], ["dark", "zh"]] as const) {
		await context.addCookies([
			{ name: "vps-theme", value: theme, url: baseURL! },
			{ name: "vps-locale", value: locale, url: baseURL! },
		]);
		await page.goto("/image-bed");
		for (const viewport of [
			{ width: 320, height: 568 }, { width: 390, height: 844 },
			{ width: 768, height: 900 }, { width: 1440, height: 960 },
			{ width: 844, height: 390 },
		]) {
			await page.setViewportSize(viewport);
			for (const item of images) {
				const opener = page.getByRole("button", { name: item.filename, exact: true });
				await expect(opener).toBeVisible();
				await opener.focus();
				await opener.press("Enter");
				const dialog = page.getByRole("dialog", { name: item.filename, exact: true });
				await expect(dialog).toBeVisible();
				const picture = dialog.locator("img");
				await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
				const layout = await picture.evaluate((img: HTMLImageElement) => {
					const box = img.getBoundingClientRect();
					return { ratio: box.width / box.height, natural: img.naturalWidth / img.naturalHeight, width: box.width, height: box.height };
				});
				expect(layout.width).toBeGreaterThan(0);
				expect(layout.height).toBeGreaterThan(0);
				expect(Math.abs(layout.ratio / layout.natural - 1)).toBeLessThan(0.02);
				for (const element of [dialog, picture, ...await dialog.getByRole("button").all()]) {
					const box = await element.boundingBox();
					expect(box).not.toBeNull();
					expect(box!.x).toBeGreaterThanOrEqual(0);
					expect(box!.y).toBeGreaterThanOrEqual(0);
					expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
					expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
				}
				await page.screenshot({ path: testInfo.outputPath(`preview-${theme}-${viewport.width}-${item.id}.png`) });
				await page.keyboard.press("Escape");
				await expect(dialog).toBeHidden();
				await expect(opener).toBeFocused();
			}
		}
	}
	expect(errors).toEqual([]);
});

test("image Token uploads return structured errors and preserve scoped access over HTTP", async ({ page, context }) => {
	test.setTimeout(150_000);
	await login(page);
	const csrf = (await context.cookies()).find((cookie) => cookie.name === "csrf_token")?.value;
	expect(csrf).toBeTruthy();
	const tokens: Array<{ token: string; apiToken: { id: string } }> = [];
	const imageIds: string[] = [];
	const upload = async (options: Parameters<typeof context.request.post>[1]) => {
		let response = await context.request.post("/api/images/upload", options);
		if (response.status() === 429) {
			// Exercise the configured five-per-minute limit without weakening it.
			const seconds = Number(response.headers()["retry-after"]);
			expect(seconds).toBeGreaterThan(0);
			expect(seconds).toBeLessThanOrEqual(60);
			await page.waitForTimeout(seconds * 1000);
			response = await context.request.post("/api/images/upload", options);
		}
		return response;
	};
	try {
		for (const scope of ["image:write", "image:read"]) {
			const created = await context.request.post("/api/api-tokens", {
				headers: { "x-csrf-token": csrf! }, data: { name: `Image E2E ${scope}`, scopes: [scope] },
			});
			expect(created.status()).toBe(201);
			tokens.push(await created.json());
		}
		const writeHeaders = { Authorization: `Bearer ${tokens[0]!.token}` };
		const readHeaders = { Authorization: `Bearer ${tokens[1]!.token}` };
		const invalid = await upload({
			headers: writeHeaders,
			multipart: { file: { name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("invalid bitmap") } },
		});
		expect(invalid.status()).toBe(400);
		expect(invalid.headers()["content-type"]).toContain("application/json");
		expect(invalid.headers()["x-request-id"]).toBeTruthy();
		expect(await invalid.json()).toHaveProperty("error");
		const bytes = await readFile(path.join(process.cwd(), "public/icon-192x192.png"));
		const multipart = { file: { name: "e2e-token-image.png", mimeType: "image/png", buffer: bytes } };
		const denied = await upload({ headers: readHeaders, multipart });
		expect(denied.status()).toBe(403);
		const linkedDenied = await upload({
			headers: writeHeaders, multipart: { ...multipart, storageNodeId: "node_local_default", relativePath: "qa-images" },
		});
		expect(linkedDenied.status()).toBe(403);
		for (const name of ["e2e-token-image.webp", "e2e-token-image.avif"]) {
			const uploaded = await upload({
				headers: writeHeaders, multipart: { file: { ...multipart.file, name } },
			});
			expect(uploaded.status()).toBe(201);
			const uploadedImage = await uploaded.json();
			expect(uploadedImage.id).toBeTruthy();
			imageIds.push(uploadedImage.id);
			expect(uploadedImage.filename).toBe(name);
			expect(uploadedImage.mimeType).toBe("image/png");
			const download = await context.request.get(`/api/images/${uploadedImage.id}/file`, { headers: readHeaders });
			expect(download.status()).toBe(200);
			expect(download.headers()["content-type"]).toContain("image/png");
			expect(await download.body()).toEqual(bytes);
		}
		const invalidQuery = await context.request.get("/api/images/list?page=0", { headers: readHeaders });
		expect(invalidQuery.status()).toBe(400);
		expect(invalidQuery.headers()["x-request-id"]).toBeTruthy();
		const revoked = await context.request.delete(`/api/api-tokens?id=${tokens[0]!.apiToken.id}`, { headers: { "x-csrf-token": csrf! } });
		expect(revoked.ok()).toBe(true);
		const afterRevoke = await upload({ headers: writeHeaders, multipart });
		expect(afterRevoke.status()).toBe(401);
	} finally {
		for (const imageId of imageIds) {
			await context.request.delete(`/api/images/${imageId}`, { headers: { "x-csrf-token": csrf! } });
		}
		for (const token of tokens) {
			await context.request.delete(`/api/api-tokens?id=${token.apiToken.id}`, { headers: { "x-csrf-token": csrf! } });
		}
	}
});

test("chunked image uploads preserve original bytes despite misleading file extensions", async ({ page, context }) => {
	test.setTimeout(60_000);
	await login(page);
	const csrf = (await context.cookies()).find((cookie) => cookie.name === "csrf_token")?.value;
	expect(csrf).toBeTruthy();
	const headers = { "x-csrf-token": csrf! };
	const bytes = await readFile(path.join(process.cwd(), "public/icon-192x192.png"));
	const imageIds: string[] = [];
	const sessionIds: string[] = [];
	try {
		for (const name of ["e2e-chunk-image.webp", "e2e-chunk-image.avif"]) {
			const initialized = await context.request.post("/api/images/upload/init", {
				headers, data: { filename: name, mimeType: "image/png", totalSize: bytes.length, chunkSize: 65536 },
			});
			expect(initialized.status()).toBe(201);
			const { session } = await initialized.json();
			sessionIds.push(session.id);
			const chunk = await context.request.put(`/api/images/upload/${session.id}/chunk?index=0&size=${bytes.length}`, {
				headers: { ...headers, "content-type": "application/octet-stream" }, data: bytes,
			});
			expect(chunk.status()).toBe(200);
			const completed = await context.request.post(`/api/images/upload/${session.id}/complete`, { headers });
			expect(completed.status()).toBe(200);
			const result = await completed.json();
			imageIds.push(result.image.id);
			expect(result.session.status).toBe("COMPLETED");
			const download = await context.request.get(result.image.publicUrl);
			expect(download.status()).toBe(200);
			expect(download.headers()["content-type"]).toContain("image/png");
			expect(await download.body()).toEqual(bytes);
		}
	} finally {
		for (const id of imageIds) await context.request.delete(`/api/images/${id}`, { headers });
		for (const id of sessionIds) await context.request.delete(`/api/images/upload/${id}`, { headers });
	}
});
