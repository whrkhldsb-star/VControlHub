import { expect, test, type Page } from "@playwright/test";
import { generate as generateTotp } from "otplib";
import { installDirectSession } from "./helpers/direct-session";
import { loginWithCredentials } from "./helpers/login";

const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "admin123";

async function login(page: Page) {
	if (process.env.E2E_DIRECT_SESSION === "1") {
		await installDirectSession(page.context());
		await page.goto("/dashboard");
		return;
	}
	await loginWithCredentials(page, USER, PASS);
}

test("settings tabs and personal preference persistence", async ({ page }) => {
	await login(page);
	await page.goto("/settings");
	const tabs = page.getByRole("tab");
	await expect.poll(() => tabs.count()).toBeGreaterThanOrEqual(3);
	const count = await tabs.count();
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

test("two-factor setup, password login, TOTP verification and disable lifecycle", async ({ page, context }) => {
	test.setTimeout(90_000);
	await login(page);
	await page.goto("/settings#2fa");

	let section = page.locator('[id="2fa"]');
	await expect(section).toBeVisible();
	const details = section.locator("details");
	if ((await details.getAttribute("open")) === null) await section.locator("summary").click();
	await section.getByRole("button", { name: /开启两步验证|Enable 2FA/i }).click();

	const secret = (await section.locator("code").textContent())?.trim();
	expect(secret).toBeTruthy();
	const setupCode = await generateTotp({ secret: secret! });
	await section.getByLabel(/验证码|Verification code/i).fill(setupCode);
	const enableResponse = page.waitForResponse((response) =>
		new URL(response.url()).pathname === "/api/auth/2fa/enable" && response.request().method() === "POST",
	);
	await section.getByRole("button", { name: /确认启用|Confirm enable/i }).click();
	const enabled = await enableResponse;
	expect(enabled.status(), `2FA enable failed: ${await enabled.text()}`).toBe(200);
	await expect(section.getByRole("button", { name: /关闭两步验证|Disable 2FA/i })).toBeVisible();

	await context.clearCookies();
	await page.goto("/login");
	await page.getByLabel(/用户名|Username/i).fill(USER);
	await page.getByLabel(/密码|Password/i).fill(PASS);
	await page.getByRole("button", { name: /登录|Sign in|Log in/i }).click();
	await page.waitForURL((url) => url.pathname === "/login/verify-2fa");

	const loginCode = await generateTotp({ secret: secret! });
	for (let index = 0; index < loginCode.length; index += 1) {
		await page.getByLabel(new RegExp(`(?:验证码第 ${index + 1} 位|Verification code digit ${index + 1})`, "i")).fill(loginCode[index]!);
	}
	await page.waitForURL((url) => !url.pathname.startsWith("/login"));

	await page.goto("/settings#2fa");
	section = page.locator('[id="2fa"]');
	await expect(section).toBeVisible();
	const refreshedDetails = section.locator("details");
	if ((await refreshedDetails.getAttribute("open")) === null) await section.locator("summary").click();
	await section.getByRole("button", { name: /关闭两步验证|Disable 2FA/i }).click();
	const disableCode = await generateTotp({ secret: secret! });
	await section.getByLabel(/当前验证码|Current code/i).fill(disableCode);
	const disableResponse = page.waitForResponse((response) =>
		new URL(response.url()).pathname === "/api/auth/2fa/disable" && response.request().method() === "POST",
	);
	await section.getByRole("button", { name: /确认关闭|Confirm disable/i }).click();
	const disabled = await disableResponse;
	expect(disabled.status(), `2FA disable failed: ${await disabled.text()}`).toBe(200);
	await expect(section.getByRole("button", { name: /开启两步验证|Enable 2FA/i })).toBeVisible();
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
	for (const path of ["/docker", "/monitoring", "/traffic", "/quick-services", "/audit", "/api-docs"]) {
		await page.goto(path);
		await expect(page.locator("h1").first()).toBeVisible();
		await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/i);
	}
});

test("API docs render and filter every catalog-backed operation", async ({ page }) => {
	await login(page);
	await page.goto("/api-docs");
	const search = page.getByRole("searchbox", { name: /API|search|搜索/i });
	await expect(search).toBeVisible();

	const spec = await page.evaluate(async () => {
		const response = await fetch("/api/docs/openapi.json");
		if (!response.ok) throw new Error(`OpenAPI request failed (${response.status})`);
		return response.json() as Promise<{
			paths: Record<string, Record<string, unknown>>;
		}>;
	});
	const operationCount = Object.values(spec.paths).reduce(
		(total, methods) => total + Object.keys(methods).length,
		0,
	);
	await expect(page.locator("article")).toHaveCount(operationCount);
	await expect(page.getByText("/api/settings", { exact: true })).toHaveCount(2);
	await expect(
		page.locator("article").filter({ has: page.getByText("/api/settings", { exact: true }) }).filter({ hasText: /PATCH/i }),
	).toHaveCount(1);
	await expect(
		page.locator("article").filter({ has: page.getByText("/api/settings", { exact: true }) }).filter({ hasText: /PUT/i }),
	).toHaveCount(0);

	await search.fill("/backups/{id}/restore");
	await expect(page.locator("article")).toHaveCount(1);
	await expect(page.locator("article").first()).toContainText(/POST/i);
	await expect(page.locator("article").first()).toContainText(/参数\s*1|1\s*(?:个)?参数|1\s*parameter/i);
});

test("advanced share policies expose only controls that affect delivery", async ({ page }) => {
	await login(page);
	await page.goto("/shares");
	await page.getByRole("button", { name: /高级创建分享链接|Advanced share link creation/i }).click();

	const permission = page.getByLabel(/权限级别|Permission level/i);
	const maxDownloads = page.getByLabel(/最大下载次数|Maximum downloads/i);
	const password = page.getByLabel(/访问密码|Access password/i);
	await expect(maxDownloads).toBeVisible();
	await expect(password).toBeVisible();
	await maxDownloads.fill("2");
	await password.fill("secret");

	await permission.selectOption("preview");
	await expect(maxDownloads).toBeHidden();
	await expect(password).toBeHidden();
	await expect(page.getByText(/仅查看模式会展示|View-only mode shows/i)).toBeVisible();

	await permission.selectOption("download");
	await expect(maxDownloads).toHaveValue("");
	await expect(password).toHaveValue("");
});

test("traffic history range and refresh controls", async ({ page }) => {
	test.setTimeout(90_000);
	await login(page);

	const localSummary = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname === "/api/traffic/summary" && !url.searchParams.has("include");
	});
	const remoteSummary = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname === "/api/traffic/summary" && url.searchParams.get("include") === "remote";
	});
	await page.goto("/traffic");
	await Promise.all([localSummary, remoteSummary]);
	await page.getByRole("button", { name: /^7d$/ }).click();
	await expect(page.getByText(/7\s*天|7\s*days/i).first()).toBeVisible();
	const refreshed = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname === "/api/traffic/summary" && !url.searchParams.has("include");
	});
	await page.getByRole("button", { name: /刷新|Refresh/i }).first().click();
	await refreshed;
	const iface = page.locator("#trafficIface");
	if (await iface.isVisible().catch(() => false)) {
		const options = await iface.locator("option").count();
		if (options > 1) await iface.selectOption({ index: 1 });
	}
	await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/i);
});

test("quick-service tabs and search remain usable", async ({ page }) => {
	await login(page);
	await page.goto("/quick-services");
	const search = page.getByRole("searchbox", { name: /搜索快捷服务|Search quick services/i });
	await search.fill("__qa_no_such_service__");
	await expect(page.locator("body")).toContainText(/没有|No .*found|暂无/i);
	await search.fill("");
	for (const name of [/本地精选|Local picks|Store/i, /社区推荐|Community/i, /已安装|Installed/i, /应用源|Sources/i]) {
		const tab = page.getByRole("tab", { name }).first();
		await expect(tab).toBeVisible();
		await tab.click();
		await expect(tab).toHaveAttribute("aria-selected", "true");
	}
});

test("Docker refresh and logs remain usable", async ({ page }) => {
	await login(page);
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
});

test("audit filters and AI/AI Ops unavailable-provider experience stay usable", async ({ page }) => {
	await login(page);
	await page.goto("/audit");
	const search = page.getByRole("searchbox", { name: /搜索动作、用户名或显示名|Search action, user or display name/i });
	await search.fill("qa-image");
	await page.getByRole("button", { name: /^(搜索|Search)$/i }).click();
	await search.fill("");
	const clear = page.getByRole("button", { name: /清除|Clear/i });
	if (await clear.isVisible().catch(() => false)) await clear.click();

	await page.goto("/ai");
	await expect(page.getByRole("heading", { name: /AI 助手|AI Assistant/i })).toBeVisible();
	const messageBox = page.getByRole("textbox").last();
	if (await messageBox.count()) {
		await expect(messageBox).toBeVisible();
		await messageBox.fill("QA connectivity check only; do not perform actions.");
		const send = page.getByRole("button", { name: /发送|Send/i }).last();
		await expect(send).toBeEnabled();
		await send.click();
		await expect(page.locator("body")).toContainText(/provider|提供商|模型|model|配置|configure/i, { timeout: 20_000 });
	} else {
		await expect(page.getByText(/没有可用的 AI 提供商|No AI providers available/i)).toBeVisible();
		await expect(page.getByRole("button", { name: /配置 AI 提供商|Configure AI provider/i })).toBeVisible();
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
	await expect(create).toBeVisible();
	await create.click();
	const server = page.locator("#downloadServer");
	await expect(server.locator("option")).not.toHaveCount(0);
	const marker = `qa-download-${Date.now()}.bin`;
	await page.locator("#download-url").fill(`https://example.com/${marker}`);
	await page.locator("#downloadFileName").fill(marker);
	const target = page.locator("#downloadTargetPath");
	if (!(await target.inputValue()).trim()) await target.fill("/tmp/vcontrolhub-qa-downloads");
	await page.getByRole("button", { name: /提交下载|Submit download|开始下载/i }).click();
	const task = page.locator("article").filter({ hasText: marker }).first();
	await expect(task).toBeVisible({ timeout: 20_000 });
	const cancel = task.getByRole("button", { name: /取消|Cancel/i });
	await expect(cancel).toBeVisible();
	await cancel.click();
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
	await expect(details).toBeVisible();
	await details.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	const detect = dialog.getByRole("button", { name: /探测 OS|Detect OS/i });
	await expect(detect).toBeVisible();
	await detect.click();
	await expect(detect).toBeEnabled({ timeout: 45_000 });
	const diagnose = dialog.getByRole("button", { name: /实时探测|Run realtime diagnostics/i });
	await expect(diagnose).toBeVisible();
	await expect(diagnose).toBeEnabled();
	await diagnose.click();
	await expect(dialog.locator('[role="status"], [role="alert"]').last()).toBeVisible({ timeout: 45_000 });
	await dialog.getByRole("button", { name: /收起详情|Collapse details/i }).click();
	await expect(dialog).toBeHidden();
});

test("team workspace create and delete lifecycle", async ({ page }) => {
	await login(page);
	await page.goto("/settings");
	const section = page.locator("#team-workspaces");
	await expect(section).toBeVisible();
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
