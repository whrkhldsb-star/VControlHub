import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { installDirectSession } from "./helpers/direct-session";
import { countTerminalReports, startScriptedSshServer, type ScriptedShell } from "./helpers/scripted-ssh-server";
import { encryptServerPassword } from "../src/lib/ssh/ssh-key-crypto";

/**
 * Real-browser check of the terminal modes a program leaves behind (opt-in
 * like the layout spec: the custom server and ssh-ws-proxy must run against a
 * disposable database, plus E2E_SSH_LAB=1).
 *
 * Regression for: a program such as Codex or Claude Code switches the
 * terminal to the alternate screen with mouse tracking. When the connection
 * then dropped and the reconnect got a NEW shell (gateway restarted during a
 * deploy, keep-alive expired, SSH connection lost), the browser terminal kept
 * those modes, so every mouse move and wheel step in the plain shell was sent
 * as a mouse report and printed as `^[[<35;…M` garbage.
 */
test.skip(process.env.E2E_SSH_LAB !== "1", "set E2E_SSH_LAB=1 with the app and ssh-ws-proxy running");

async function openTerminal(page: Page, serverName: string) {
	await page.goto("/servers", { waitUntil: "networkidle" });
	await page.getByRole("tab", { name: /VPS 总览/ }).or(page.getByRole("button", { name: /VPS 总览/ })).first().click();
	await page.getByText(serverName).first().waitFor();
	// Each browser project has its own server; open exactly that one.
	await page.getByRole("button", { name: `打开 ${serverName} SSH 终端` }).click();
	await page.locator(".xterm-rows").filter({ hasText: "lab-shell-1$" }).waitFor({ timeout: 60_000 });
}

/** Move across the terminal and turn the wheel both ways over it. */
async function exerciseMouse(page: Page) {
	const box = (await page.locator(".xterm-screen").boundingBox())!;
	await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
	await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 });
	await page.mouse.wheel(0, -400);
	await page.mouse.wheel(0, 400);
	// Reports travel browser → gateway → SSH; give them time to land.
	await page.waitForTimeout(800);
}

async function typeLine(page: Page, text: string) {
	await page.locator(".xterm-helper-textarea").focus();
	await page.keyboard.type(text);
	await page.keyboard.press("Enter");
}

test("a new shell after a reconnect starts with clean terminal modes; a resumed shell keeps them", async ({ browser, baseURL }, testInfo) => {
	test.setTimeout(180_000);
	// Projects run in parallel: each needs its own server row and fake SSH server.
	const SERVER_ID = `e2e-ssh-modes-${testInfo.project.name}`;
	const SERVER_NAME = `ssh-modes-${testInfo.project.name}`;
	const fake = await startScriptedSshServer({ username: "modes", password: "modes-pass" });
	const db = new Client({ connectionString: process.env.DATABASE_URL });
	await db.connect();
	const shell = (number: number): ScriptedShell => {
		const found = fake.shells.find((candidate) => candidate.number === number);
		if (!found) throw new Error(`shell ${number} not started`);
		return found;
	};
	try {
		const team = await db.query<{ currentTeamId: string | null }>(`SELECT "currentTeamId" FROM "User" WHERE username = $1`, [process.env.E2E_DIRECT_USER ?? "admin"]);
		await db.query(`DELETE FROM servers WHERE id = $1`, [SERVER_ID]);
		await db.query(
			`INSERT INTO servers (id, name, host, port, username, "connectionType", password, "hostKeySha256", tags, "teamId", "updatedAt")
			 VALUES ($1, $6, '127.0.0.1', $2, 'modes', 'PASSWORD', $3, $4, '{}', $5, now())`,
			[SERVER_ID, fake.port, encryptServerPassword("modes-pass"), fake.fingerprint, team.rows[0]?.currentTeamId ?? null, SERVER_NAME],
		);
		const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, baseURL, locale: "zh-CN" });
		await installDirectSession(context);
		// Keep a handle on the page's sockets so the spec can drop the SSH
		// WebSocket the way a network change does, without touching the shell.
		await context.addInitScript(() => {
			const Native = window.WebSocket;
			const sockets: WebSocket[] = [];
			(window as unknown as { __labSockets: WebSocket[] }).__labSockets = sockets;
			window.WebSocket = class extends Native {
				constructor(url: string | URL, protocols?: string | string[]) {
					super(url, protocols);
					sockets.push(this);
				}
			} as typeof WebSocket;
		});
		const page = await context.newPage();
		if (process.env.LAB_DEBUG === "1") {
			const t0 = Date.now();
			const log = (message: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${message}`);
			page.on("websocket", (socket) => {
				if (!socket.url().includes("/ssh?")) return;
				log(`ws open ${socket.url().includes("resume=") ? "(resume)" : ""}`);
				socket.on("framereceived", (frame) => { const text = String(frame.payload); if (!text.includes('"output"') && !text.includes("input-ack")) log(`<< ${text.slice(0, 160)}`); });
				socket.on("close", () => log("ws closed"));
			});
			page.on("request", (request) => { if (request.url().includes("ws-token")) log("token request"); });
		}
		await openTerminal(page, SERVER_NAME);
		const xterm = page.locator(".xterm").first();
		const rows = page.locator(".xterm-rows");

		// 1. Plain shell: the wheel scrolls, nothing reaches the shell.
		await typeLine(page, "seq");
		await rows.filter({ hasText: "line 120" }).waitFor();
		let mark = shell(1).received.length;
		await exerciseMouse(page);
		expect(countTerminalReports(shell(1).received.slice(mark)), "plain shell").toEqual({ mouse: 0, focus: 0 });
		await expect(xterm).not.toHaveClass(/enable-mouse-events/);

		// 2. A full-screen program owns the mouse: it gets reports.
		await typeLine(page, "tui");
		await rows.filter({ hasText: "TUI-RUNNING" }).waitFor();
		await expect(xterm).toHaveClass(/enable-mouse-events/);
		mark = shell(1).received.length;
		await exerciseMouse(page);
		expect(countTerminalReports(shell(1).received.slice(mark)).mouse, "full-screen program").toBeGreaterThan(0);

		// 3. The browser's connection drops but the gateway keeps the shell
		// (keep-alive is on by default): the reconnect resumes it, the program
		// is still running, so its modes must survive.
		await page.evaluate(() => {
			for (const socket of (window as unknown as { __labSockets: WebSocket[] }).__labSockets) {
				if (socket.url.includes("/ssh?") && socket.readyState === WebSocket.OPEN) socket.close();
			}
		});
		await expect(page.getByTestId("ssh-terminal-session-notice")).toBeVisible({ timeout: 30_000 });
		expect(fake.shells.length, "the reconnect resumed the same shell").toBe(1);
		await expect(xterm).toHaveClass(/enable-mouse-events/);
		mark = shell(1).received.length;
		await exerciseMouse(page);
		expect(countTerminalReports(shell(1).received.slice(mark)).mouse, "resumed full-screen program").toBeGreaterThan(0);

		// 4. The connection is lost while the program runs and the reconnect
		// gets a new shell: none of the old program's modes may leak into it.
		await typeLine(page, "drop");
		await rows.filter({ hasText: "lab-shell-2$" }).waitFor({ timeout: 60_000 });
		await expect(xterm).not.toHaveClass(/enable-mouse-events/);
		mark = shell(2).received.length;
		await exerciseMouse(page);
		await page.locator(".xterm-helper-textarea").focus();
		await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => undefined);
		await page.locator(".xterm-helper-textarea").focus();
		expect(countTerminalReports(shell(2).received.slice(mark)), "new shell after reconnect").toEqual({ mouse: 0, focus: 0 });
		expect(await rows.innerText(), "no escape garbage on screen").not.toContain("^[[");
		// The new shell is on the normal screen, so the old output is scrollback again.
		await typeLine(page, "echo ok");
		await rows.filter({ hasText: "lab-shell-2$ echo ok" }).waitFor();

		// 5. A program that exits cleanly leaves a plain shell behind.
		await typeLine(page, "tui");
		await rows.filter({ hasText: "TUI-RUNNING" }).waitFor();
		await typeLine(page, "tui-exit");
		await expect(xterm).not.toHaveClass(/enable-mouse-events/);
		mark = shell(2).received.length;
		await exerciseMouse(page);
		expect(countTerminalReports(shell(2).received.slice(mark)), "after a clean exit").toEqual({ mouse: 0, focus: 0 });

		// 6. Typing `exit` ends the shell on purpose: no automatic new shell,
		// the user decides; the next shell again starts clean.
		await typeLine(page, "tui");
		await rows.filter({ hasText: "TUI-RUNNING" }).waitFor();
		await typeLine(page, "exit");
		await expect(page.getByRole("button", { name: /^重连$|^Reconnect$/ }).first()).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText(/Shell 已退出（退出码 0）/)).toBeVisible();
		await page.waitForTimeout(4_000);
		expect(fake.shells.length, "no automatic shell after exit").toBe(2);
		await expect(page.getByTestId("ssh-terminal-retry")).toHaveCount(0);
		await page.getByRole("button", { name: /^重连$|^Reconnect$/ }).first().click();
		await rows.filter({ hasText: "lab-shell-3$" }).waitFor({ timeout: 30_000 });
		await expect(xterm).not.toHaveClass(/enable-mouse-events/);
		mark = shell(3).received.length;
		await exerciseMouse(page);
		expect(countTerminalReports(shell(3).received.slice(mark)), "after exit and manual reconnect").toEqual({ mouse: 0, focus: 0 });

		await context.close();
	} finally {
		await db.query(`DELETE FROM servers WHERE id = $1`, [SERVER_ID]).catch(() => undefined);
		await db.end();
		await fake.close();
	}
});
