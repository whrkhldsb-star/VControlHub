import { expect, test, type Page } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";

const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "admin123";
const marker = `E2E-${Date.now()}`;

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

test.beforeEach(async ({ page }) => login(page));

test("snippet create, search, edit and delete", async ({ page }) => {
	await page.goto("/snippets");
	await page.getByRole("button", { name: /新建片段|New snippet/i }).click();
	const create = page.getByRole("dialog", { name: /新建代码片段|New code snippet/i });
	await create.getByLabel(/标题|Title/i).fill(marker);
	await create.getByLabel(/内容|Content/i).fill("echo e2e");
	await create.getByRole("button", { name: /创建|Create/i }).click();
	await expect(page.getByText(marker, { exact: true })).toBeVisible();
	await page.getByRole("searchbox", { name: /搜索代码片段|Search snippets/i }).fill(marker);
	await expect(page.getByText(marker, { exact: true })).toBeVisible();
	await page.getByRole("button", { name: /编辑|Edit/i }).first().click();
	const edit = page.getByRole("dialog", { name: /编辑代码片段|Edit code snippet/i });
	await edit.getByLabel(/标题|Title/i).fill(`${marker}-edited`);
	await edit.getByRole("button", { name: /保存|Save/i }).click();
	await expect(page.getByText(`${marker}-edited`, { exact: true })).toBeVisible();
	await page.getByRole("button", { name: /删除代码片段|Delete code snippet/i }).click();
	await page.getByRole("dialog", { name: /删除代码片段|Delete code snippet/i }).getByRole("button", { name: /确认删除|Confirm delete/i }).click();
	await expect(page.getByText(`${marker}-edited`, { exact: true })).toBeHidden();
});

test("announcement create, search, edit and delete", async ({ page }) => {
	await page.goto("/announcements");
	await page.getByLabel(/标题|Title/i).fill(marker);
	await page.getByLabel(/内容|Content/i).fill("E2E announcement body");
	await page.getByRole("button", { name: /发布公告|Publish announcement/i }).click();
	await expect(page.getByText(marker, { exact: true })).toBeVisible();
	await page.getByRole("searchbox", { name: /搜索公告|Search announcements/i }).fill(marker);
	await page.getByRole("button", { name: /^编辑$|^Edit$/i }).click();
	const edit = page.getByRole("dialog");
	await edit.getByLabel(/标题|Title/i).fill(`${marker}-edited`);
	await edit.getByRole("button", { name: /保存|Save/i }).click();
	await expect(page.getByText(`${marker}-edited`, { exact: true })).toBeVisible();
	await page.getByRole("button", { name: /删除公告|Delete announcement/i }).click();
	await page.getByRole("dialog", { name: /删除公告|Delete announcement/i }).getByRole("button", { name: /确认删除|Confirm delete/i }).click();
	await expect(page.getByText(`${marker}-edited`, { exact: true })).toBeHidden();
});

test("alert rule create, toggle and delete", async ({ page }) => {
	await page.goto("/alert-rules");
	await page.getByRole("button", { name: /创建告警规则|Create alert rule/i }).click();
	await page.getByLabel(/规则名称|Rule name/i).fill(marker);
	await page.getByLabel(/阈值|Threshold/i).fill("99");
	await page.getByRole("button", { name: /创建规则|Create rule/i }).click();
	await expect(page.getByText(marker, { exact: true })).toBeVisible();
	await page.getByRole("button", { name: /暂停|Pause/i }).first().click();
	await expect(page.getByRole("button", { name: /启用|Enable/i }).first()).toBeVisible();
	await page.getByRole("button", { name: /删除|Delete/i }).first().click();
	await page.getByRole("dialog", { name: /删除告警规则|Delete alert rule/i }).getByRole("button", { name: /确认删除|Confirm delete/i }).click();
	await expect(page.getByText(marker, { exact: true })).toBeHidden();
});

test("command template create and delete without deployment", async ({ page }) => {
	await page.goto("/templates");
	await page.getByRole("button", { name: /创建模板|New template/i }).click();
	await page.getByLabel(/模板名称|Template name/i).fill(marker);
	await page.getByLabel(/命令内容|Command/i).fill("echo e2e");
	await page.getByRole("button", { name: /^创建模板$|^Create template$/i }).click();
	await expect(page.getByText(marker, { exact: true })).toBeVisible();
	const card = page.getByText(marker, { exact: true }).locator("xpath=ancestor::*[self::article or @data-card][1]");
	await card.getByRole("button", { name: /删除|Delete/i }).click();
	await page.getByRole("dialog", { name: /删除命令模板|Delete command template/i }).getByRole("button", { name: /确认删除|Confirm delete/i }).click();
	await expect(page.getByText(marker, { exact: true })).toBeHidden();
});

test("ticket create and dynamic detail page", async ({ page }) => {
	await page.goto("/tickets");
	await page.getByLabel(/标题|Title/i).fill(marker);
	await page.getByLabel(/描述|Description/i).fill("E2E ticket body");
	await page.getByRole("button", { name: /提交工单|Submit ticket/i }).click();
	const link = page.getByRole("link", { name: new RegExp(marker) });
	await expect(link).toBeVisible();
	await link.click();
	await expect(page).toHaveURL(/\/tickets\/[^/]+$/);
	await expect(page.getByText(marker, { exact: true })).toBeVisible();
});

test("API token create, plaintext display and revoke", async ({ page }) => {
	await page.goto("/api-tokens");
	await page.getByLabel(/Token 名称|Token name/i).fill(marker);
	await page.getByRole("button", { name: /创建 Token|Create Token/i }).click();
	await expect(page.locator("code").filter({ hasText: /\S+/ }).first()).toBeVisible();
	await expect(page.getByText(marker, { exact: true })).toBeVisible();
	await page.getByRole("button", { name: new RegExp(`撤销.*${marker}|Revoke.*${marker}`, "i") }).click();
	const dialog = page.getByRole("dialog", { name: /确认撤销|Confirm revoke/i });
	await dialog.getByRole("button", { name: /确认撤销|Confirm revoke/i }).click();
	await expect(page.getByText(/已撤销|Revoked/i).last()).toBeVisible();
});

test("scheduled task create, search, pause and delete without execution", async ({ page }) => {
	await page.goto("/scheduled-tasks");
	await page.getByRole("button", { name: /创建定时任务|Create scheduled task/i }).click();
	await page.getByRole("textbox", { name: /任务名称|Task name/i }).fill(marker);
	await page.getByRole("textbox", { name: /Cron 表达式|Cron expression/i }).fill("0 0 31 12 *");
	await page.getByRole("textbox", { name: /命令内容|Command/i }).fill("echo e2e-safe");
	const server = page.getByRole("group", { name: /目标节点|Target nodes/i }).getByRole("checkbox").first();
	await server.check();
	await page.getByRole("button", { name: /创建任务|Create task/i }).click();
	await page.getByRole("searchbox", { name: /搜索定时任务|Search scheduled/i }).fill(marker);
	await expect(page.getByText(marker, { exact: true })).toBeVisible();
	await page.getByRole("button", { name: /暂停|Pause/i }).first().click();
	await expect(page.getByRole("button", { name: /恢复|Resume/i }).first()).toBeVisible();
	await page.getByRole("button", { name: /删除|Delete/i }).first().click();
	await page.getByRole("dialog", { name: /确认删除定时任务|Delete scheduled task/i }).getByRole("button", { name: /确认删除|Confirm delete/i }).click();
	await expect(page.getByText(marker, { exact: true })).toBeHidden();
});

test("playbook create, dry-run, toggle and delete", async ({ page }) => {
	await page.goto("/playbooks");
	await page.getByRole("button", { name: /新建 Playbook|New Playbook/i }).first().click();
	await page.getByLabel(/Playbook 名称|Playbook Name/i).fill(marker);
	await page.getByLabel(/步骤名称|Step name/i).fill("safe dry run");
	await page.getByLabel("command", { exact: true }).fill("echo e2e-safe");
	await page.getByRole("button", { name: /保存 Playbook|Save Playbook/i }).click();
	await expect(page.getByText(marker, { exact: true })).toBeVisible();
	const card = page.getByText(marker, { exact: true }).locator("xpath=ancestor::article[1]");
	await card.getByRole("button", { name: /Dry-run/i }).click();
	await expect(card.getByText(/dry-run/i).last()).toBeVisible();
	await card.getByRole("button", { name: /启用 \/ 停用|Enable \/ Disable/i }).click();
	await card.getByRole("button", { name: /删除|Delete/i }).click();
	await page.getByRole("dialog", { name: /删除 Playbook|Delete Playbook/i }).getByRole("button", { name: /确认删除|Confirm Delete/i }).click();
	await expect(page.getByText(marker, { exact: true })).toBeHidden();
});

test("cost entry create, edit and delete", async ({ page }) => {
	await page.goto("/cost-summary");
	await page.getByRole("button", { name: /新增条目|New Entry/i }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(/服务提供方|Provider/i).fill(marker);
	await dialog.getByLabel(/金额|Amount/i).fill("12.34");
	await dialog.getByLabel(/备注|Notes/i).fill("e2e cost");
	await dialog.getByRole("button", { name: /保存条目|Save Entry/i }).click();
	const row = page.getByRole("row").filter({ hasText: marker });
	await expect(row).toBeVisible();
	await row.getByRole("button", { name: /编辑|Edit/i }).click();
	const edit = page.getByRole("dialog");
	await edit.getByLabel(/金额|Amount/i).fill("23.45");
	await edit.getByRole("button", { name: /保存条目|Save Entry/i }).click();
	await expect(page.getByRole("row").filter({ hasText: marker })).toContainText("23.45");
	await page.getByRole("row").filter({ hasText: marker }).getByRole("button", { name: /删除|Delete/i }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: /确认删除|Confirm Delete/i }).click();
	await expect(page.getByRole("row").filter({ hasText: marker })).toBeHidden();
});

test("user create, password reset, disable and enable", async ({ page }) => {
	const username = `qa_${Date.now()}`;
	await page.goto("/users");
	await page.getByRole("button", { name: /创建用户|Create user/i }).click();
	await page.getByLabel(/用户名|Username/i).fill(username);
	await page.getByLabel(/显示名称|Display name/i).fill(marker);
	await page.getByLabel(/密码 \*|Password \*/i).fill("Qa-User-2026!safe");
	await page.getByRole("button", { name: /确认创建|Confirm create/i }).click();
	await expect(page.getByText(`@${username}`, { exact: true })).toBeVisible();
	const row = page.getByText(`@${username}`, { exact: true }).locator("xpath=ancestor::div[contains(@class,'sm:items-center')][1]");
	await row.getByRole("button", { name: /重置密码|Reset password/i }).click();
	const dialog = page.getByRole("dialog");
	await dialog.locator('input[type="password"]').fill("Qa-User-2026!reset");
	await dialog.getByRole("button", { name: /确认重置|Confirm reset/i }).click();
	await row.getByRole("button", { name: /禁用|Disable/i }).click();
	await expect(page.getByText(`@${username}`, { exact: true }).locator("xpath=ancestor::div[contains(@class,'sm:items-center')][1]").getByRole("button", { name: /启用|Enable/i })).toBeVisible();
	await page.getByText(`@${username}`, { exact: true }).locator("xpath=ancestor::div[contains(@class,'sm:items-center')][1]").getByRole("button", { name: /启用|Enable/i }).click();
});

test("backup schedule create, pause and delete without running backup", async ({ page }) => {
	await page.goto("/backups");
	await page.locator("#schedule-backup-name").fill(marker);
	await page.locator("#schedule-backup-cron").fill("0 0 31 12 *");
	await page.locator("#schedule-backup-retention").fill("1");
	await page.getByRole("button", { name: /创建备份计划|Create backup schedule/i }).click();
	const item = page.getByText(marker, { exact: true }).locator("xpath=ancestor::div[contains(@class,'px-4')][1]");
	await expect(item).toBeVisible();
	await item.getByRole("button", { name: /暂停\/恢复|Pause\/Resume/i }).click();
	await item.getByRole("button", { name: /删除|Delete/i }).click();
	await page.getByRole("dialog", { name: /确认删除|Confirm delete/i }).getByRole("button", { name: /确认删除|Confirm delete/i }).click();
	await expect(page.getByText(marker, { exact: true })).toBeHidden();
});
