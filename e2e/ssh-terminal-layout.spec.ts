import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { installDirectSession } from "./helpers/direct-session";
import { startFakeSshServer } from "./helpers/fake-ssh-server";
import { encryptServerPassword } from "../src/lib/ssh/ssh-key-crypto";

/**
 * Real-browser layout check for the SSH terminal (opt-in: needs the custom
 * server and the ssh-ws-proxy running against a disposable database, plus
 * E2E_SSH_LAYOUT_LAB=1). In every window state the xterm grid must fit the
 * visible part of the dialog — the last row on screen — and the remote PTY must
 * have exactly the grid's size, from the first draw on.
 *
 * Regression for: outside full screen the grid was sized to a surface taller
 * than the dialog showed (bottom rows clipped), and the shell started at 80x24
 * because the browser's first resize arrived before the shell existed.
 */
test.skip(process.env.E2E_SSH_LAYOUT_LAB !== "1", "set E2E_SSH_LAYOUT_LAB=1 with the app and ssh-ws-proxy running");

const SERVER_ID = "e2e-ssh-layout";

async function layout(page: Page) {
	return page.evaluate(() => {
		const surface = document.querySelector('[data-testid="ssh-terminal-surface"]') as HTMLElement;
		const rows = Array.from(surface.querySelectorAll(".xterm-rows > div")) as HTMLElement[];
		let top = -Infinity;
		let bottom = Infinity;
		for (let el: HTMLElement | null = surface; el; el = el.parentElement) {
			const style = getComputedStyle(el);
			if (el === surface || style.overflow !== "visible" || style.overflowY !== "visible") {
				const rect = el.getBoundingClientRect();
				top = Math.max(top, rect.top);
				bottom = Math.min(bottom, rect.bottom);
			}
		}
		bottom = Math.min(bottom, window.innerHeight);
		const last = rows.find((row) => row.textContent?.includes("BOTTOM-ROW"))?.getBoundingClientRect();
		return {
			gridRows: rows.length,
			gridCols: rows[0]?.textContent?.replace(/\s+$/, "").length ?? 0,
			lastRowVisible: Boolean(last && last.top >= top - 0.5 && last.bottom <= bottom + 0.5),
		};
	});
}

async function expectGridMatchesPty(page: Page, windows: Array<{ cols: number; rows: number }>, state: string) {
	await expect.poll(async () => {
		const grid = await layout(page);
		const pty = windows.at(-1);
		return { ...grid, ptyMatches: pty?.cols === grid.gridCols && pty?.rows === grid.gridRows };
	}, { message: state, timeout: 10_000 }).toEqual(expect.objectContaining({ lastRowVisible: true, ptyMatches: true }));
}

test("terminal grid fits the visible dialog and matches the PTY in every window state", async ({ browser, baseURL }) => {
	test.setTimeout(300_000);
	const fake = await startFakeSshServer({ username: "layout", password: "layout-pass" });
	const db = new Client({ connectionString: process.env.DATABASE_URL });
	await db.connect();
	try {
		const team = await db.query<{ currentTeamId: string | null }>(`SELECT "currentTeamId" FROM "User" WHERE username = $1`, [process.env.E2E_DIRECT_USER ?? "admin"]);
		await db.query(`DELETE FROM servers WHERE id = $1`, [SERVER_ID]);
		await db.query(
			`INSERT INTO servers (id, name, host, port, username, "connectionType", password, "hostKeySha256", tags, "teamId", "updatedAt")
			 VALUES ($1, 'ssh-layout', '127.0.0.1', $2, 'layout', 'PASSWORD', $3, $4, '{}', $5, now())`,
			[SERVER_ID, fake.port, encryptServerPassword("layout-pass"), fake.fingerprint, team.rows[0]?.currentTeamId ?? null],
		);
		for (const viewport of [
			{ width: 1366, height: 768 },
			{ width: 1920, height: 1080 },
			// sm..lg: the dialog is already 72vh while the frame is not yet lg:min-h-0.
			{ width: 900, height: 600 },
			{ width: 768, height: 600 },
			{ width: 1280, height: 520 },
			{ width: 390, height: 844 },
		]) {
			const context = await browser.newContext({ viewport, baseURL, locale: "zh-CN" });
			await installDirectSession(context);
			const page = await context.newPage();
			await page.goto("/servers", { waitUntil: "networkidle" });
			await page.getByRole("tab", { name: /VPS 总览/ }).or(page.getByRole("button", { name: /VPS 总览/ })).first().click();
			await page.getByText("ssh-layout").first().waitFor();
			await page.getByRole("button", { name: /SSH 终端|SSH terminal|终端/i }).first().click();
			const dialog = page.locator('[data-ssh-terminal-dialog="true"]');
			await page.locator(".xterm-rows").filter({ hasText: "BOTTOM-ROW" }).waitFor({ timeout: 60_000 });
			const label = `${viewport.width}x${viewport.height}`;
			await expectGridMatchesPty(page, fake.windows, `${label} initial`);
			await dialog.getByRole("button", { name: /全屏|Full screen/i }).first().click();
			await expectGridMatchesPty(page, fake.windows, `${label} full screen`);
			await dialog.getByRole("button", { name: /退出全屏|Exit full screen/i }).first().click();
			await expectGridMatchesPty(page, fake.windows, `${label} back from full screen`);
			await page.setViewportSize({ width: Math.round(viewport.width * 0.8), height: Math.round(viewport.height * 0.85) });
			await expectGridMatchesPty(page, fake.windows, `${label} window shrunk`);
			await page.setViewportSize(viewport);
			await expectGridMatchesPty(page, fake.windows, `${label} window restored`);
			const minimize = dialog.getByRole("button", { name: /最小化|Minimize/i }).first();
			if (await minimize.count()) {
				await minimize.click();
				await page.getByTestId("ssh-terminal-minimized-pill").click();
				await expectGridMatchesPty(page, fake.windows, `${label} restored from minimized`);
			}
			await context.close();
		}
	} finally {
		await db.query(`DELETE FROM servers WHERE id = $1`, [SERVER_ID]).catch(() => undefined);
		await db.end();
		await fake.close();
	}
});
