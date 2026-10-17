import { expect, test, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Terminal } from "@xterm/xterm";

/**
 * The real xterm and the real connection controller in a browser, with a fake
 * gateway socket. No server, database or SSH host is needed, so CI runs it in
 * every browser (the full-stack variant is e2e/ssh-terminal-modes.spec.ts).
 *
 * Regression for: a program (Codex, Claude Code) left mouse tracking and the
 * alternate screen on, the connection dropped, and the reconnect got a new
 * shell; every mouse move and wheel step then typed `^[[<35;…M` into it.
 */
declare global {
	interface Window {
		modesLab: {
			term: Terminal;
			data: string[];
			sockets: Array<{ url: string; onopen: (() => void) | null; onmessage: ((event: { data: string }) => void) | null; onclose: (() => void) | null; readyState: number }>;
		};
	}
}

test.describe.configure({ mode: "serial" });

let server: Server;
let url: string;
test.beforeAll(async () => {
	const bundle = buildSync({
		stdin: {
			contents: `import { Terminal } from '@xterm/xterm';
import { createSshTerminalConnection } from './src/components/ssh-terminal-connection';
const term = new Terminal({ cols: 80, rows: 12 });
term.open(document.getElementById('terminal'));
const data = [];
term.onData((chunk) => data.push(chunk));
const sockets = [];
class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 0; this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null; sockets.push(this); }
  send() {}
  close() {}
}
createSshTerminalConnection({
  serverId: 'lab', terminal: term, fitGrid() {}, keepAlive: () => true,
  fetchHandshakeToken: async () => 'token', location: { protocol: 'http:', host: 'lab.invalid' }, t: (key) => key,
  onState() {}, onSession() {}, onInputOverflow() {}, createSocket: (socketUrl) => new FakeSocket(socketUrl),
}).start();
window.modesLab = { term, data, sockets };
term.write('history-before-the-program\\r\\n', () => { document.body.dataset.ready = 'yes'; });`,
			resolveDir: process.cwd(), loader: "ts",
		},
		bundle: true, write: false, platform: "browser", format: "iife", tsconfig: "tsconfig.json",
	}).outputFiles[0]!.text;
	const css = readFileSync("node_modules/@xterm/xterm/css/xterm.css", "utf8");
	server = createServer((_req, res) => {
		res.setHeader("Content-Type", "text/html; charset=utf-8");
		res.end(`<style>${css}</style><div id="terminal" style="width:720px;height:240px"></div><script>${bundle}</script>`);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))); });

const PROGRAM_STARTS = "\x1b[?1049h\x1b[H\x1b[2J\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?1004h\x1b[?25lFULL-SCREEN-PROGRAM";

/** Deliver gateway frames on the newest socket. */
async function gateway(page: Page, frames: Array<Record<string, unknown>>) {
	await page.evaluate((list) => {
		const socket = window.modesLab.sockets.at(-1)!;
		for (const frame of list) {
			if (frame.type === "open") { socket.readyState = 1; socket.onopen?.(); continue; }
			if (frame.type === "drop") { socket.readyState = 3; socket.onclose?.(); continue; }
			socket.onmessage?.({ data: JSON.stringify(frame) });
		}
	}, frames);
}

async function attach(page: Page, session: { resumeId: string; resumed: boolean }) {
	await gateway(page, [{ type: "open" }, { type: "connected", inputAck: true }, { type: "session", keepAliveMs: 600_000, ...session }]);
}

async function program(page: Page) {
	const encoded = Buffer.from(PROGRAM_STARTS, "utf8").toString("base64");
	await gateway(page, [{ type: "output", data: encoded }]);
	await expect(page.locator(".xterm")).toHaveClass(/enable-mouse-events/);
}

/** Mouse moves and wheel steps over the terminal; returns what xterm sent. */
async function mouseInput(page: Page) {
	await page.evaluate(() => { window.modesLab.data.length = 0; });
	const box = (await page.locator(".xterm-screen").boundingBox())!;
	await page.mouse.move(box.x + 40, box.y + 30);
	await page.mouse.move(box.x + 300, box.y + 120, { steps: 6 });
	await page.mouse.wheel(0, -300);
	await page.mouse.wheel(0, 300);
	await page.waitForTimeout(200);
	return page.evaluate(() => window.modesLab.data.join(""));
}

async function reconnect(page: Page) {
	await gateway(page, [{ type: "drop" }]);
	await expect.poll(() => page.evaluate(() => window.modesLab.sockets.length), { timeout: 5_000 }).toBeGreaterThan(1);
}

test("a resumed shell keeps the running program's modes", async ({ page }) => {
	await page.goto(url);
	await expect(page.locator("body")).toHaveAttribute("data-ready", "yes");
	await expect.poll(() => page.evaluate(() => window.modesLab.sockets.length)).toBe(1);
	await attach(page, { resumeId: "shell-1", resumed: false });
	await program(page);
	expect(await mouseInput(page)).toMatch(/\x1b\[<\d+;\d+;\d+M/);

	await reconnect(page);
	await attach(page, { resumeId: "shell-1", resumed: true });
	await expect(page.locator(".xterm")).toHaveClass(/enable-mouse-events/);
	expect(await mouseInput(page)).toMatch(/\x1b\[<\d+;\d+;\d+M/);
});

test("a new shell after a reconnect gets clean modes and the old screen back", async ({ page }) => {
	await page.goto(url);
	await expect(page.locator("body")).toHaveAttribute("data-ready", "yes");
	await expect.poll(() => page.evaluate(() => window.modesLab.sockets.length)).toBe(1);
	await attach(page, { resumeId: "shell-1", resumed: false });
	await program(page);

	await reconnect(page);
	await attach(page, { resumeId: "shell-2", resumed: false });
	await expect(page.locator(".xterm")).not.toHaveClass(/enable-mouse-events/);
	expect(await mouseInput(page)).toBe("");
	const state = await page.evaluate(() => {
		const { term } = window.modesLab;
		const lines: string[] = [];
		for (let index = 0; index < term.buffer.active.length; index += 1) lines.push(term.buffer.active.getLine(index)?.translateToString(true) ?? "");
		return { buffer: term.buffer.active.type, mouse: term.modes.mouseTrackingMode, text: lines.join("\n") };
	});
	expect(state.buffer).toBe("normal");
	expect(state.mouse).toBe("none");
	// The normal screen and its history are back; the seam marks the new shell.
	expect(state.text).toContain("history-before-the-program");
	expect(state.text).toContain("sshTerminalModal.sessionFreshLine");
	expect(state.text).not.toContain("FULL-SCREEN-PROGRAM");
});
