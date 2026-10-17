import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { installDirectSession } from "./helpers/direct-session";
import { startFreezableTcpProxy } from "./helpers/freezable-tcp-proxy";
import { countTerminalReports, startScriptedSshServer } from "./helpers/scripted-ssh-server";
import { encryptServerPassword } from "../src/lib/ssh/ssh-key-crypto";

/**
 * Real-browser check that a terminal survives the connection failures that
 * made it unusable behind a CDN: the WebSocket goes silent without closing
 * (a lost route, an edge that dropped the flow), while a program is idle,
 * while it streams output, and while a full-screen program runs — plus a page
 * reload and an explicit close. Opt-in like the other terminal lab specs: the
 * custom server and ssh-ws-proxy must run against a disposable database, with
 * E2E_SSH_LAB=1, and the gateway must accept the relay origins
 * (http://127.0.0.1:3495–3497 by default, one per browser project).
 *
 * The page talks to the app through a relay that can silence its WebSocket.
 * Every output frame the browser receives, on every socket, is recorded: the
 * concatenation must be exactly the shell's output — nothing missing after a
 * reconnect, nothing twice — and the shell must be the same one throughout.
 */
test.skip(process.env.E2E_SSH_LAB !== "1", "set E2E_SSH_LAB=1 with the app and ssh-ws-proxy running");

const RELAY_BASE_PORT = Number(process.env.E2E_SSH_RELAY_PORT ?? 3495);
const PROJECT_OFFSET: Record<string, number> = { chromium: 0, firefox: 1, webkit: 2 };

type Received = { url: string; text: string };

/** Record what the page receives on its terminal sockets (decoded output only). */
function recordTerminalSockets(page: Page) {
	const sockets: Received[] = [];
	page.on("websocket", (ws) => {
		if (!ws.url().includes("/ssh?")) return;
		const entry: Received = { url: ws.url(), text: "" };
		sockets.push(entry);
		ws.on("framereceived", (frame) => {
			try {
				const message = JSON.parse(String(frame.payload)) as { type?: string; data?: string };
				if (message.type === "output" && message.data) entry.text += Buffer.from(message.data, "base64").toString("latin1");
			} catch { /* not a gateway message */ }
		});
	});
	return {
		sockets,
		all: () => sockets.map((socket) => socket.text).join(""),
		/** Wait for the next terminal socket after `count`, i.e. a reconnect. */
		next: async (count: number, timeout = 45_000) => {
			await expect.poll(() => sockets.length, { timeout }).toBeGreaterThan(count);
			return sockets[count]!;
		},
	};
}

async function openTerminal(page: Page, serverName: string) {
	await page.goto("/servers", { waitUntil: "networkidle" });
	await page.getByRole("tab", { name: /VPS 总览/ }).or(page.getByRole("button", { name: /VPS 总览/ })).first().click();
	await page.getByText(serverName).first().waitFor();
	await page.getByRole("button", { name: `打开 ${serverName} SSH 终端` }).click();
	await page.locator(".xterm-rows").filter({ hasText: "lab-shell-1$" }).waitFor({ timeout: 60_000 });
}

async function typeLine(page: Page, text: string) {
	await page.locator(".xterm-helper-textarea").focus();
	await page.keyboard.type(text);
	await page.keyboard.press("Enter");
}

/** Ticks in the order the browser received them. */
function ticks(text: string) {
	return [...text.matchAll(/tick (\d{6})/g)].map((match) => Number(match[1]));
}

test("a terminal continues the same shell, without losing or repeating output, when its WebSocket goes silent", async ({ browser }, testInfo) => {
	test.setTimeout(420_000);
	const project = testInfo.project.name;
	const SERVER_ID = `e2e-ssh-resilience-${project}`;
	const SERVER_NAME = `ssh-resilience-${project}`;
	const appUrl = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3491");
	const relayPort = RELAY_BASE_PORT + (PROJECT_OFFSET[project] ?? 0);
	const relay = await startFreezableTcpProxy({ listenPort: relayPort, targetPort: Number(appUrl.port) });
	const fake = await startScriptedSshServer({ username: "resilience", password: "resilience-pass" });
	const db = new Client({ connectionString: process.env.DATABASE_URL });
	await db.connect();
	try {
		const team = await db.query<{ currentTeamId: string | null }>(`SELECT "currentTeamId" FROM "User" WHERE username = $1`, [process.env.E2E_DIRECT_USER ?? "admin"]);
		await db.query(`DELETE FROM servers WHERE id = $1`, [SERVER_ID]);
		await db.query(
			`INSERT INTO servers (id, name, host, port, username, "connectionType", password, "hostKeySha256", tags, "teamId", "updatedAt")
			 VALUES ($1, $6, '127.0.0.1', $2, 'resilience', 'PASSWORD', $3, $4, '{}', $5, now())`,
			[SERVER_ID, fake.port, encryptServerPassword("resilience-pass"), fake.fingerprint, team.rows[0]?.currentTeamId ?? null, SERVER_NAME],
		);
		const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, baseURL: `http://127.0.0.1:${relayPort}`, locale: "zh-CN" });
		await installDirectSession(context);
		const page = await context.newPage();
		const record = recordTerminalSockets(page);
		await openTerminal(page, SERVER_NAME);
		expect(record.sockets).toHaveLength(1);

		await test.step("idle: the socket goes silent, the terminal notices and continues the same shell", async () => {
			expect(relay.freezeWebSockets("drop")).toBe(1);
			const resumed = await record.next(1);
			// It asks for the output after the last byte it has.
			expect(resumed.url).toMatch(/resume=[0-9a-f]{32}&offset=\d+/);
			expect(Number(/offset=(\d+)/.exec(resumed.url)![1])).toBe(record.sockets[0]!.text.length);
			await expect(page.getByText("已接回中断前的会话。")).toBeVisible();
			await typeLine(page, "hello");
			await expect(page.locator(".xterm-rows")).toContainText("hello");
			await expect.poll(() => fake.shells.length).toBe(1);
		});

		await test.step("streaming: output lost on the silent socket is replayed exactly once", async () => {
			await typeLine(page, "stream");
			await expect.poll(() => Math.max(0, ...ticks(record.all())), { timeout: 20_000 }).toBeGreaterThan(40);
			expect(relay.freezeWebSockets("drop")).toBe(1);
			await record.next(2);
			await expect.poll(() => record.sockets[2]!.text.length, { timeout: 20_000 }).toBeGreaterThan(0);
			await page.waitForTimeout(1_000);
			await page.locator(".xterm-helper-textarea").focus();
			await page.keyboard.press("Control+c");
			await expect(page.locator(".xterm-rows")).toContainText("^C");
			const seen = ticks(record.all());
			expect(seen.length).toBeGreaterThan(100);
			expect(seen).toEqual(seen.map((_, index) => index + 1));
			expect(fake.shells).toHaveLength(1);
		});

		await test.step("full-screen program: the shell is continued with its modes, and leaves no mouse garbage after it exits", async () => {
			await typeLine(page, "tui");
			await expect(page.locator(".xterm-rows")).toContainText("TUI-RUNNING");
			await expect(page.locator(".xterm")).toHaveClass(/enable-mouse-events/);
			expect(relay.freezeWebSockets("stall")).toBe(1);
			await record.next(3);
			await expect(page.getByText("已接回中断前的会话。")).toBeVisible();
			// Still the same full-screen program: it keeps receiving the mouse.
			await expect(page.locator(".xterm")).toHaveClass(/enable-mouse-events/);
			await typeLine(page, "tui-exit");
			await expect(page.locator(".xterm")).not.toHaveClass(/enable-mouse-events/);
			const mark = fake.shells[0]!.received.length;
			const box = (await page.locator(".xterm-screen").boundingBox())!;
			await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
			await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 });
			await page.mouse.wheel(0, -400);
			await page.mouse.wheel(0, 400);
			await page.waitForTimeout(800);
			expect(countTerminalReports(fake.shells[0]!.received.slice(mark)).mouse).toBe(0);
			expect(fake.shells).toHaveLength(1);
		});

		await test.step("mouse tracking left on by a dead program is switched off after its first echo", async () => {
			await typeLine(page, "leak");
			await expect(page.locator(".xterm")).toHaveClass(/enable-mouse-events/);
			const mark = fake.shells[0]!.received.length;
			const box = (await page.locator(".xterm-screen").boundingBox())!;
			for (let step = 0; step < 4; step += 1) {
				await page.mouse.move(box.x + box.width * (0.2 + step * 0.1), box.y + box.height * 0.4, { steps: 6 });
				await page.mouse.wheel(0, step % 2 ? 300 : -300);
				await page.waitForTimeout(300);
			}
			await expect(page.locator(".xterm")).not.toHaveClass(/enable-mouse-events/);
			await expect(page.getByText(/已在本地关闭鼠标上报/)).toBeVisible();
			// Only what was in flight before the echo came back reached the shell.
			expect(countTerminalReports(fake.shells[0]!.received.slice(mark)).mouse).toBeLessThanOrEqual(12);
			const after = fake.shells[0]!.received.length;
			await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 10 });
			await page.mouse.wheel(0, -400);
			await page.waitForTimeout(800);
			expect(countTerminalReports(fake.shells[0]!.received.slice(after)).mouse).toBe(0);
		});

		await test.step("a page reload continues the shell with its recent output", async () => {
			await page.reload({ waitUntil: "networkidle" });
			await openTerminal(page, SERVER_NAME);
			const reloaded = record.sockets.at(-1)!;
			expect(reloaded.url).toMatch(/resume=[0-9a-f]{32}&offset=0/);
			// The new page gets the shell's recent output, from before the reload too.
			await expect.poll(() => reloaded.text).toContain("hello");
			await expect(page.locator(".xterm-rows")).toContainText("lab-shell-1$");
			expect(fake.shells).toHaveLength(1);
		});

		await test.step("closing the terminal ends the shell", async () => {
			// The terminal window's own close button (the panel toolbar has one too).
			await page.locator('[data-action-button][aria-label="关闭 SSH 终端"]').click();
			await expect.poll(() => fake.shells[0]!.closed, { timeout: 15_000 }).toBe(true);
			expect(await page.evaluate(() => Object.keys(window.sessionStorage).filter((key) => key.startsWith("ssh-terminal-resume:")))).toEqual([]);
		});
		await context.close();
	} finally {
		await db.query(`DELETE FROM servers WHERE id = $1`, [SERVER_ID]).catch(() => undefined);
		await db.end();
		await fake.close();
		await relay.close();
	}
});
