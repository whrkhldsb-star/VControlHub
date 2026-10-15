import { expect, test, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Terminal } from "@xterm/xterm";

declare global {
	interface Window {
		clipboardLab: { term: Terminal; data: string[]; errors: number };
	}
}

// The actual xterm and application key handlers, not a mock. No SSH host,
// credentials or database needed; input is captured instead of sent remotely.
test.describe.configure({ mode: "serial" });

let server: Server;
let url: string;
test.beforeAll(async () => {
	const bundle = buildSync({
		stdin: {
			contents: `import { Terminal } from '@xterm/xterm';
import { installSshTerminalIme } from './src/components/ssh-terminal-ime';
import { chainSshTerminalCopyPaste } from './src/components/ssh-terminal-copy-paste';
const term = new Terminal({ cols: 80, rows: 10 });
term.open(document.getElementById('terminal'));
window.clipboardLab = { term, data: [], errors: 0 };
term.onData(data => window.clipboardLab.data.push(data));
installSshTerminalIme(term, chainSshTerminalCopyPaste(term, () => true, copied => { if (!copied) window.clipboardLab.errors++; }));
term.write('COPY-ME 中文', () => document.body.dataset.ready = 'yes');`,
			resolveDir: process.cwd(), loader: "ts",
		},
		bundle: true, write: false, platform: "browser", format: "iife",
	}).outputFiles[0]!.text;
	const css = readFileSync("node_modules/@xterm/xterm/css/xterm.css", "utf8");
	server = createServer((_req, res) => {
		res.setHeader("Content-Type", "text/html; charset=utf-8");
		res.end(`<style>${css}</style><div id="terminal"></div><textarea id="clipboard"></textarea><script>${bundle}</script>`);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });

async function select(page: Page) {
	await page.evaluate(() => {
		window.clipboardLab.term.select(0, 0, 7);
		window.clipboardLab.term.focus();
	});
}
async function seedClipboard(page: Page, text: string) {
	await page.locator("#clipboard").fill(text);
	await page.locator("#clipboard").selectText();
	await page.keyboard.press("ControlOrMeta+c");
}
async function readClipboard(page: Page) {
	await page.locator("#clipboard").fill("");
	await page.keyboard.press("ControlOrMeta+v");
	return page.locator("#clipboard").inputValue();
}
test.beforeEach(async ({ page }) => {
	await page.goto(url);
	await expect(page.locator("body")).toHaveAttribute("data-ready", "yes");
});

test("copy works without Async Clipboard API and preserves selection on repeat", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	await seedClipboard(page, "old clipboard");
	await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
	await page.reload();
	await expect(page.locator("body")).toHaveAttribute("data-ready", "yes");
	await select(page);
	await page.keyboard.press("ControlOrMeta+c");
	await page.keyboard.press("ControlOrMeta+c");
	await expect.poll(() => page.evaluate(() => window.clipboardLab.data)).toEqual([]);
	expect(await readClipboard(page)).toBe("COPY-ME");
	expect(errors).toEqual([]);
});

test("native paste sends one bracketed payload and normalizes newlines", async ({ page, context, browserName }) => {
	if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await seedClipboard(page, "first\nsecond");
	await page.evaluate(() => new Promise<void>(resolve => window.clipboardLab.term.write("\x1b[?2004h", resolve)));
	await page.evaluate(() => window.clipboardLab.term.focus());
	await page.keyboard.press("ControlOrMeta+v");
	// Allow any incorrectly scheduled async read to arrive after native paste.
	await page.waitForTimeout(250);
	await expect.poll(() => page.evaluate(() => window.clipboardLab.data)).toEqual(["\x1b[200~first\rsecond\x1b[201~"]);
});

test("copy shortcut with Shift does not send interrupt; bare Ctrl+C still does", async ({ page }) => {
	await select(page);
	await page.keyboard.press("Control+Shift+c");
	expect(await readClipboard(page)).toBe("COPY-ME");
	expect(await page.evaluate(() => window.clipboardLab.data)).toEqual([]);
	await page.evaluate(() => { window.clipboardLab.term.clearSelection(); window.clipboardLab.term.focus(); });
	await page.keyboard.press("Control+Shift+c");
	await page.keyboard.press("Control+c");
	expect(await page.evaluate(() => window.clipboardLab.data)).toEqual(["\x03"]);
});

test("mouse reporting supports Shift-drag selection without sending mouse packets", async ({ page }) => {
	await page.evaluate(() => new Promise<void>(resolve => window.clipboardLab.term.write("\x1b[?1000h\x1b[?1006h", resolve)));
	const screen = await page.locator(".xterm-screen").boundingBox();
	if (!screen) throw new Error("terminal screen missing");
	const cell = screen.width / 80;
	await page.keyboard.down("Shift");
	await page.mouse.move(screen.x + cell * 0.1, screen.y + 8);
	await page.mouse.down();
	await page.mouse.move(screen.x + cell * 7.1, screen.y + 8, { steps: 8 });
	await page.mouse.up();
	await page.keyboard.up("Shift");
	expect(await page.evaluate(() => window.clipboardLab.term.getSelection())).toBe("COPY-ME");
	await page.keyboard.press("ControlOrMeta+c");
	expect(await readClipboard(page)).toBe("COPY-ME");
	expect(await page.evaluate(() => window.clipboardLab.data)).toEqual([]);
});
