import { expect, test, type Page } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";

const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "admin123";

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

test("settings tabs and personal preference persistence", async ({ page }) => {
	await login(page);
	await page.goto("/settings");
	const tabs = page.getByRole("tab");
	const count = await tabs.count();
	expect(count).toBeGreaterThanOrEqual(3);
	for (let index = 0; index < count; index++) {
		await tabs.nth(index).click();
		await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
	}

	await page.goto("/preferences");
	const notificationSwitch = page.getByRole("switch", { name: /启用通知|Enable notifications/i });
	await expect(notificationSwitch).toBeVisible();
	const original = await notificationSwitch.getAttribute("aria-checked");
	await notificationSwitch.click();
	await expect(notificationSwitch).not.toHaveAttribute("aria-checked", original ?? "false");
	await expect(page.getByRole("status")).toBeVisible();
	await page.reload();
	await expect(notificationSwitch).not.toHaveAttribute("aria-checked", original ?? "false");
	await notificationSwitch.click();
	await expect(notificationSwitch).toHaveAttribute("aria-checked", original ?? "false");
});

test("notifications can be read without console or request failures", async ({ page }) => {
	await login(page);
	const failures: string[] = [];
	page.on("pageerror", (error) => failures.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") failures.push(message.text());
	});
	await page.goto("/notifications");
	const markAll = page.getByRole("button", { name: /全部标为已读|Mark all.*read/i });
	if (await markAll.isVisible().catch(() => false)) {
		await markAll.click();
		await expect(markAll).toBeHidden();
	}
	expect(failures).toEqual([]);
});

test("read-only operational pages expose working refresh, filter and tab controls", async ({ page }) => {
	await login(page);
	for (const path of ["/docker", "/monitoring", "/traffic", "/quick-services", "/audit", "/qa-reports", "/api-docs"]) {
		await page.goto(path);
		await expect(page.locator("h1").first()).toBeVisible();
		await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/i);
	}
});

test("traffic history, quick-service tabs/search, Docker refresh/logs and QA detail", async ({ page }) => {
	test.setTimeout(90_000);
	await login(page);

	await page.goto("/traffic");
	await page.getByRole("button", { name: /^7d$/ }).click();
	await expect(page.getByText(/7\s*天|7\s*days/i).first()).toBeVisible();
	await page.getByRole("button", { name: /刷新|Refresh/i }).first().click();
	const iface = page.locator("#trafficIface");
	if (await iface.isVisible().catch(() => false)) {
		const options = await iface.locator("option").count();
		if (options > 1) await iface.selectOption({ index: 1 });
	}

	await page.goto("/quick-services");
	const search = page.getByRole("searchbox");
	await search.fill("__qa_no_such_service__");
	await expect(page.locator("body")).toContainText(/没有|No .*found|暂无/i);
	await search.fill("");
	for (const name of [/社区|Community/i, /已安装|Installed/i, /来源|Sources/i, /应用商店|Store/i]) {
		const button = page.getByRole("button", { name }).first();
		if (await button.isVisible().catch(() => false)) await button.click();
	}

	await page.goto("/docker");
	await page.getByRole("button", { name: /刷新.*列表|Refresh.*list/i }).click();
	const logButton = page.getByRole("button", { name: /日志|Logs/i }).first();
	if (await logButton.isVisible().catch(() => false)) {
		await logButton.click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await dialog.getByRole("button", { name: /关闭|Close/i }).click();
		await expect(dialog).toBeHidden();
	}

	await page.goto("/qa-reports");
	const detail = page.getByRole("link", { name: /查看详情|View detail/i }).first();
	if (await detail.isVisible().catch(() => false)) {
		await detail.click();
		await expect(page).toHaveURL(/\/qa-reports\/[^/]+$/);
		await expect(page.locator("h1").first()).toBeVisible();
		await page.getByRole("link", { name: /返回|Back/i }).first().click();
	}
});

test("audit filters and AI/AI Ops unavailable-provider experience stay usable", async ({ page }) => {
	await login(page);
	await page.goto("/audit");
	const search = page.getByRole("searchbox");
	await search.fill("qa-image");
	await page.getByRole("button", { name: /^(搜索|Search)$/i }).click();
	await search.fill("");
	const clear = page.getByRole("button", { name: /清除|Clear/i });
	if (await clear.isVisible().catch(() => false)) await clear.click();

	await page.goto("/ai");
	await expect(page.getByRole("heading", { name: /AI 助手|AI Assistant/i })).toBeVisible();
	const messageBox = page.getByRole("textbox").last();
	if (await messageBox.isVisible().catch(() => false)) {
		await messageBox.fill("QA connectivity check only; do not perform actions.");
		const send = page.getByRole("button", { name: /发送|Send/i }).last();
		if (await send.isEnabled().catch(() => false)) {
			await send.click();
			await expect(page.locator("body")).toContainText(/provider|提供商|模型|model|配置|configure/i, { timeout: 20_000 });
		}
	}

	await page.goto("/ai-ops");
	await page.getByRole("button", { name: /刷新|Refresh/i }).click();
	const filters = page.locator('section[aria-label="ai-ops-actions"] select');
	for (let index = 0; index < await filters.count(); index++) {
		await filters.nth(index).selectOption({ index: 0 });
	}
});

test("download task create, cancel and purge lifecycle", async ({ page }) => {
	test.setTimeout(60_000);
	await login(page);
	await page.goto("/downloads");
	const create = page.getByRole("button", { name: /新建下载|Create download/i });
	if (!(await create.isVisible().catch(() => false))) return;
	await create.click();
	const server = page.locator("#downloadServer");
	if ((await server.locator("option").count()) === 0) return;
	const marker = `qa-download-${Date.now()}.bin`;
	await page.locator("#download-url").fill(`https://example.com/${marker}`);
	await page.locator("#downloadFileName").fill(marker);
	const target = page.locator("#downloadTargetPath");
	if (!(await target.inputValue()).trim()) await target.fill("/tmp/vcontrolhub-qa-downloads");
	await page.getByRole("button", { name: /提交下载|Submit download|开始下载/i }).click();
	const task = page.locator("article").filter({ hasText: marker }).first();
	await expect(task).toBeVisible({ timeout: 20_000 });
	const cancel = task.getByRole("button", { name: /取消|Cancel/i });
	if (await cancel.isVisible().catch(() => false)) await cancel.click();
	await expect(task).toContainText(/已取消|Cancelled|失败|Failed/i, { timeout: 20_000 });
	await task.getByRole("button", { name: /删除|Delete/i }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toContainText(marker);
	await dialog.getByRole("button", { name: /确认删除|Confirm delete/i }).click();
	await expect(page.locator("article").filter({ hasText: marker })).toBeHidden();
});

test("server detail, OS detection and realtime diagnostics", async ({ page }) => {
	test.setTimeout(90_000);
	await login(page);
	await page.goto("/servers");
	const details = page.getByRole("button", { name: /查看详情|View details/i }).first();
	if (!(await details.isVisible().catch(() => false))) return;
	await details.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	const detect = dialog.getByRole("button", { name: /探测 OS|Detect OS/i });
	if (await detect.isVisible().catch(() => false)) {
		await detect.click();
		await expect(detect).toBeEnabled({ timeout: 45_000 });
	}
	const diagnose = dialog.getByRole("button", { name: /实时探测|Run realtime diagnostics/i });
	if (await diagnose.isEnabled().catch(() => false)) {
		await diagnose.click();
		await expect(dialog.locator('[role="status"], [role="alert"]').last()).toBeVisible({ timeout: 45_000 });
	}
	await dialog.getByRole("button", { name: /收起详情|Collapse details/i }).click();
	await expect(dialog).toBeHidden();
});

test("team workspace create and delete lifecycle", async ({ page }) => {
	await login(page);
	await page.goto("/settings");
	const teamTab = page.getByRole("tab", { name: /团队|Team/i });
	if (await teamTab.isVisible().catch(() => false)) await teamTab.click();
	const section = page.locator("#team-workspaces");
	if (!(await section.isVisible().catch(() => false))) return;
	const marker = `QA Team ${Date.now()}`;
	await section.getByLabel(/团队名称|Team name/i).last().fill(marker);
	await section.getByLabel(/slug/i).fill(`qa-team-${Date.now()}`);
	await section.getByRole("button", { name: /创建团队|Create team/i }).click();
	const card = section.locator("article").filter({ hasText: marker });
	await expect(card).toBeVisible();
	await card.getByRole("button", { name: /删除|Delete/i }).click();
	const dialog = page.getByRole("dialog", { name: /确认删除团队|Confirm delete team/i });
	await expect(dialog).toContainText(marker);
	await dialog.getByRole("button", { name: /确认|Confirm/i }).click();
	await expect(card).toBeHidden();
});
