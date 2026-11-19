import { createHash } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { utils } from "ssh2";
import { installDirectSession } from "./helpers/direct-session";
import { startScriptedSshServer } from "./helpers/scripted-ssh-server";
import { decryptServerPassword, encryptServerPassword, encryptSshPrivateKey } from "../src/lib/ssh/ssh-key-crypto";

/**
 * A Linux node's login can be changed from its edit form: the username, the
 * password, and a switch to an SSH key from the library. Saving logs in with
 * the new credential first, so a wrong one is refused and nothing changes.
 * The fake SSH server listens on 127.0.0.2: loopback, but not an address the
 * app treats as "this host", so every save really authenticates.
 */


async function openNodeDetails(page: Page, serverName: string): Promise<Locator> {
	// A save ends in router.refresh(): let it finish, or it aborts the navigation.
	await page.waitForLoadState("networkidle");
	const url = `/servers?query=${encodeURIComponent(serverName)}`;
	await page.goto(url, { waitUntil: "networkidle" }).catch(async (error: unknown) => {
		// The dev server reloads Firefox/WebKit pages once as they load; that
		// reload lands on the same URL, so only it is tolerated.
		if (!/interrupted by another navigation|NS_BINDING_ABORTED/.test(String(error))) throw error;
		await page.waitForLoadState("networkidle");
	});
	const button = page.locator("[data-server-card]").filter({ hasText: serverName }).getByRole("button", { name: /查看详情|View details/i });
	const dialog = page.getByRole("dialog");
	// Development reloads can replace a card between its first paint and hydration.
	await expect(async () => {
		if (!(await dialog.isVisible())) await button.click({ timeout: 3_000 });
		await expect(dialog).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	return dialog;
}

async function openEditForm(page: Page, serverName: string): Promise<Locator> {
	const dialog = await openNodeDetails(page, serverName);
	await dialog.getByRole("button", { name: /编辑节点|Edit node/i }).click();
	return dialog.getByRole("form");
}

/** Waits for the save's own result (the form holds other status regions). */
async function expectSaved(form: Locator) {
	await expect(form.locator("div[role=status]").filter({ hasText: /节点已更新/ })).toBeVisible({ timeout: 30_000 });
}

test("a node's username, password and SSH key can be changed, and a wrong credential is refused", async ({ browser, baseURL }, testInfo) => {
	test.setTimeout(120_000);
	const suffix = testInfo.project.name;
	const SERVER_ID = `e2e-cred-edit-${suffix}`;
	const SERVER_NAME = `cred-edit-${suffix}`;
	const KEY_NAME = `cred-edit-key-${suffix}`;
	const key = utils.generateKeyPairSync("ed25519");
	const keyBlob = Buffer.from(key.public.trim().split(/\s+/)[1]!, "base64");
	const keyFingerprint = `SHA256:${createHash("sha256").update(keyBlob).digest("base64").replace(/=+$/, "")}`;
	const fake = await startScriptedSshServer({
		username: "first",
		password: "first-pass",
		accounts: [{ username: "second", password: "second-pass" }, { username: "keyed", publicKey: key.public }],
		host: "127.0.0.2",
	});
	const db = new Client({ connectionString: process.env.DATABASE_URL });
	await db.connect();
	try {
		const user = await db.query<{ id: string; currentTeamId: string | null }>(`SELECT id, "currentTeamId" FROM "User" WHERE username = $1`, [process.env.E2E_DIRECT_USER ?? "admin"]);
		const teamId = user.rows[0]?.currentTeamId ?? null;
		await db.query(`DELETE FROM servers WHERE id = $1`, [SERVER_ID]);
		await db.query(`DELETE FROM "SshKey" WHERE name = $1`, [KEY_NAME]);
		await db.query(
			`INSERT INTO servers (id, name, host, port, username, "connectionType", password, "hostKeySha256", tags, "teamId", "updatedAt")
			 VALUES ($1, $2, '127.0.0.2', $3, 'first', 'PASSWORD', $4, $5, '{}', $6, now())`,
			[SERVER_ID, SERVER_NAME, fake.port, encryptServerPassword("first-pass"), fake.fingerprint, teamId],
		);
		const keyRow = await db.query<{ id: string }>(
			`INSERT INTO "SshKey" (id, name, fingerprint, "publicKey", "privateKey", "createdById", "teamId", "updatedAt")
			 VALUES ('e2e-cred-key-' || $1, $2, $3, $4, $5, $6, $7, now()) RETURNING id`,
			[suffix, KEY_NAME, keyFingerprint, key.public, encryptSshPrivateKey(key.private), user.rows[0]!.id, teamId],
		);
		const row = async () => (await db.query<{ username: string; connectionType: string; password: string | null; sshKeyId: string | null }>(
			`SELECT username, "connectionType", password, "sshKeyId" FROM servers WHERE id = $1`, [SERVER_ID])).rows[0]!;

		const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, baseURL, locale: "zh-CN" });
		await installDirectSession(context);
		const page = await context.newPage();

		// 1. A wrong password is refused and the node keeps its login.
		let form = await openEditForm(page, SERVER_NAME);
		await form.getByLabel(/^用户名$/).fill("second");
		await form.locator('input[name="password"]').fill("not-the-password");
		await form.getByRole("button", { name: /保存并校验连接/ }).click();
		// The refusal comes from the login itself, not from an unreachable server.
		await expect(form.getByRole("alert").filter({ hasText: /second@127\.0\.0\.2/ })).toBeVisible({ timeout: 30_000 });
		await expect(form.getByRole("alert")).not.toContainText("ECONNREFUSED");
		expect(await row()).toMatchObject({ username: "first", connectionType: "PASSWORD" });

		// 2. The right username and password are saved.
		form = await openEditForm(page, SERVER_NAME);
		await form.getByLabel(/^用户名$/).fill("second");
		await form.locator('input[name="password"]').fill("second-pass");
		await form.getByRole("button", { name: /保存并校验连接/ }).click();
		await expectSaved(form);
		const afterPassword = await row();
		expect(afterPassword).toMatchObject({ username: "second", connectionType: "PASSWORD" });
		expect(decryptServerPassword(afterPassword.password!)).toBe("second-pass");

		// 3. Switching to an SSH key: a key and its account replace the password.
		form = await openEditForm(page, SERVER_NAME);
		await form.getByRole("button", { name: "SSH 密钥", exact: true }).click();
		await form.locator('select[name="sshKeyId"]').selectOption({ label: KEY_NAME });
		await form.getByLabel(/^用户名$/).fill("keyed");
		await form.getByRole("button", { name: /保存并校验连接/ }).click();
		await expectSaved(form);
		expect(await row()).toEqual({ username: "keyed", connectionType: "SSH_KEY", password: null, sshKeyId: keyRow.rows[0]!.id });

		// 4. Back to a password: the field is required, since nothing is kept.
		form = await openEditForm(page, SERVER_NAME);
		await expect(form.locator('select[name="sshKeyId"]')).toHaveValue(keyRow.rows[0]!.id);
		await form.getByRole("button", { name: "密码", exact: true }).click();
		await expect(form.locator('input[name="password"]')).toHaveAttribute("required", "");
		await context.close();
	} finally {
		await db.query(`DELETE FROM servers WHERE id = $1`, [SERVER_ID]).catch(() => undefined);
		await db.query(`DELETE FROM "SshKey" WHERE name = $1`, [KEY_NAME]).catch(() => undefined);
		await db.end();
		await fake.close();
	}
});

test("copies a server name with consecutive spaces and confirms deletion", async ({ browser, baseURL }, testInfo) => {
	const SERVER_ID = `e2e-delete-spaces-${testInfo.project.name}`;
	const spacedName = `${SERVER_ID}  west`;
	const db = new Client({ connectionString: process.env.DATABASE_URL });
	await db.connect();
	const context = await browser.newContext({ baseURL, locale: "zh-CN" });
	try {
		await db.query("DELETE FROM servers WHERE id = $1", [SERVER_ID]);
		await db.query(
			`INSERT INTO servers (id, name, host, username, tags, "teamId", "updatedAt")
			 SELECT $1, $2, '192.0.2.99', 'fixture', '{}', "currentTeamId", now() FROM "User" WHERE username = $3`,
			[SERVER_ID, spacedName, process.env.E2E_DIRECT_USER ?? "admin"],
		);
		await installDirectSession(context);
		const page = await context.newPage();
		const details = await openNodeDetails(page, SERVER_ID);
		await details.getByRole("button", { name: /删除节点|Delete node/i }).click();
		const confirm = details.locator('input[name="confirmName"]');
		await expect(confirm).toBeVisible();
		expect(await details.locator(`label[for="delete-confirm-name-${SERVER_ID}"]`).innerText()).toContain(spacedName);
		// Capture the browser clipboard write without depending on OS clipboard permissions.
		await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
			configurable: true, value: { writeText: async (text: string) => { window.sessionStorage.setItem("copied-server-name", text); } },
		}));
		await details.getByRole("button", { name: /复制服务器名称|Copy server name/i }).click();
		const copied = await page.evaluate(() => window.sessionStorage.getItem("copied-server-name"));
		expect(copied).toBe(spacedName);
		await confirm.fill(copied!);
		await details.getByRole("button", { name: /^(确认删除|Delete)$/i }).click();
		await expect.poll(async () => (await db.query("SELECT id FROM servers WHERE id = $1", [SERVER_ID])).rowCount).toBe(0);
	} finally {
		await context.close();
		await db.query("DELETE FROM servers WHERE id = $1", [SERVER_ID]);
		await db.end();
	}
});
