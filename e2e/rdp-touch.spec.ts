import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { devices, expect, test, type Browser, type BrowserContextOptions, type CDPSession, type Locator, type Page } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";
import { GuacParser, instruction } from "../src/lib/rdp/protocol";

test.use({ serviceWorkers: "block" });

/**
 * A phone has no mouse. The remote desktop is driven as in Microsoft's Remote Desktop app: a finger moves a
 * visible pointer (mouse pointer mode) or points directly (direct touch), two fingers right-click, scroll and
 * zoom, and the on-screen keyboard comes up with its button and goes away with the same button. Real Chromium
 * touch input (CDP) against the real Guacamole client; only the RDP transport is a fixture, which records what
 * the remote desktop would receive.
 */
type Sent = string[];

async function withRdpPhone(
	browser: Browser,
	baseURL: string | undefined,
	run: (phone: { page: Page; desktop: Locator; cdp: CDPSession; sent: Sent[]; box: { x: number; y: number; width: number; height: number }; id: string }) => Promise<void>,
	contextOptions: BrowserContextOptions = {},
) {
	const db = new Client({ connectionString: process.env.DATABASE_URL });
	await db.connect();
	const id = `rdp-touch-${randomUUID()}`;
	try {
		const account = await db.query('SELECT "currentTeamId" FROM "User" WHERE username = $1', [process.env.E2E_USER]);
		await db.query(`INSERT INTO servers (id,name,host,port,username,"rdpPassword",tags,enabled,"connectionType","operatingSystem","teamId","createdAt","updatedAt")
			VALUES ($1,$1,'192.0.2.1',3389,'fixture','unused',ARRAY[$1],true,'PASSWORD','WINDOWS',$2,NOW(),NOW())`, [id, account.rows[0].currentTeamId]);
		const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "zh-CN", ...contextOptions });
		await installDirectSession(context);
		const page = await context.newPage();
		const pageErrors: string[] = [];
		page.on("pageerror", error => pageErrors.push(error.message));
		await page.route("**/api/auth/rdp-ticket", route => route.fulfill({ json: { token: "fixture-ticket", path: "/rdp" } }));
		const sent: Sent[] = [];
		await page.routeWebSocket(/\/rdp(?:\?|$)/, ws => {
			const parser = new GuacParser(row => {
				sent.push(row);
				if (row[0] === "") ws.send(instruction(...row));
			});
			ws.onMessage(data => {
				if (data === "fixture-ticket") ws.send(instruction("", "fixture") + instruction("size", "0", "1280", "720") + instruction("sync", "1"));
				else parser.feed(String(data));
			});
		});
		await page.goto(`/servers/${id}/remote-desktop`, { waitUntil: "networkidle" });
		// A development server draws its own indicator over the bottom-left corner, where the extra keys are.
		await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
		const desktop = page.getByTestId(`rdp-panel-${id}`);
		await expect(desktop.getByRole("status").filter({ hasText: "已连接" })).toBeVisible({ timeout: 30_000 });
		const box = (await desktop.getByRole("application").boundingBox())!;
		// WebKit has no DevTools protocol: the test that runs there taps through page.touchscreen instead.
		const cdp = browser.browserType().name() === "chromium" ? await context.newCDPSession(page) : (undefined as unknown as CDPSession);
		await run({ page, desktop, cdp, sent, box, id });
		expect(pageErrors).toEqual([]);
		await context.close();
	} finally {
		await db.query("DELETE FROM servers WHERE id=$1", [id]);
		await db.end();
	}
}

const mice = (sent: Sent[]) => sent.filter(row => row[0] === "mouse").map(row => ({ x: Number(row[1]), y: Number(row[2]), mask: Number(row[3]) }));
const keys = (sent: Sent[]) => sent.filter(row => row[0] === "key").map(row => `${row[1]}:${row[2]}`);
const sizes = (sent: Sent[]) => sent.filter(row => row[0] === "size");

type Point = [number, number];
const points = (list: Point[]) => list.map(([x, y], index) => ({ x, y, id: index + 1 }));
async function touchDown(cdp: CDPSession, list: Point[]) { await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(list) }); }
async function touchMove(cdp: CDPSession, list: Point[]) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(list) }); }
async function touchUp(cdp: CDPSession) { await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
async function tap(cdp: CDPSession, list: Point[]) { await touchDown(cdp, list); await touchUp(cdp); }
/** Fingers travel from `from` to `to` in a few steps. */
async function travel(cdp: CDPSession, from: Point[], to: Point[]) {
	await touchDown(cdp, from);
	for (let step = 1; step <= 8; step += 1) {
		await touchMove(cdp, from.map(([x, y], index) => [x + ((to[index]![0] - x) * step) / 8, y + ((to[index]![1] - y) * step) / 8] as Point));
	}
	await touchUp(cdp);
}
const active = (page: Page) => page.evaluate(() => document.activeElement?.tagName ?? "");
/** A point of the picture by fraction of its size; the bottom of the screen carries toasts that would swallow a tap, so stay in the upper part. */
type Box = { x: number; y: number; width: number; height: number };
const at = (box: Box, fx: number, fy: number): Point => [box.x + box.width * fx, box.y + box.height * fy];

test("fingers drive the remote mouse as the Remote Desktop app does", async ({ browser, browserName, baseURL }) => {
	test.skip(browserName !== "chromium", "touch input is driven through Chromium's DevTools protocol");
	test.setTimeout(120_000);
	await withRdpPhone(browser, baseURL, async ({ page, desktop, cdp, sent, box }) => {
		await expect(desktop.getByTestId("rdp-pointer-mode")).toHaveAccessibleName("鼠标指针模式");
		const scrollBefore = await page.evaluate(() => window.scrollY);

		// Mouse pointer mode: the pointer starts in the middle of the 1280 × 720 desktop and a drag moves it.
		await expect.poll(() => mice(sent).length).toBeGreaterThan(0);
		const start = mice(sent).at(-1)!;
		expect(Math.abs(start.x - 640)).toBeLessThanOrEqual(2);
		expect(Math.abs(start.y - 360)).toBeLessThanOrEqual(2);
		sent.length = 0;
		await travel(cdp, [at(box, 0.25, 0.25)], [at(box, 0.45, 0.5)]);
		await expect.poll(() => mice(sent).length).toBeGreaterThan(2);
		const moved = mice(sent).at(-1)!;
		expect(moved.mask).toBe(0);
		expect(moved.x).toBeGreaterThan(start.x);
		expect(moved.y).toBeGreaterThan(start.y);
		// The page itself did not scroll under the finger, and no touch raised the keyboard.
		expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
		expect(await active(page)).not.toBe("TEXTAREA");
		await expect(desktop.getByRole("textbox", { name: "远程桌面键盘输入" })).toHaveAttribute("inputmode", "none");

		// A tap is a left click where the pointer is — not under the finger.
		await page.waitForTimeout(400);
		sent.length = 0;
		await tap(cdp, [at(box, 0.55, 0.3)]);
		await expect.poll(() => mice(sent).some(m => m.mask === 1)).toBe(true);
		expect(mice(sent).filter(m => m.mask === 1).every(m => m.x === moved.x && m.y === moved.y)).toBe(true);
		expect(await active(page)).not.toBe("TEXTAREA");

		// A two-finger tap is a right click; two fingers dragging up scroll the content down (the wheel).
		await page.waitForTimeout(400);
		sent.length = 0;
		await tap(cdp, [at(box, 0.33, 0.3), at(box, 0.45, 0.3)]);
		await expect.poll(() => mice(sent).some(m => m.mask === 4)).toBe(true);
		await page.waitForTimeout(400);
		sent.length = 0;
		await travel(cdp, [at(box, 0.33, 0.8), at(box, 0.45, 0.8)], [at(box, 0.33, 0.25), at(box, 0.45, 0.25)]);
		await expect.poll(() => mice(sent).some(m => m.mask === 16)).toBe(true);

		// A pinch zooms into the picture and shows the pan control; pinching back fits it again.
		const surface = desktop.getByRole("application");
		await page.waitForTimeout(400);
		await travel(cdp, [at(box, 0.4, 0.45), at(box, 0.55, 0.45)], [at(box, 0.28, 0.45), at(box, 0.69, 0.45)]);
		await expect.poll(() => surface.evaluate(element => (element as HTMLElement).style.transform)).toContain("scale(");
		await expect(desktop.getByTestId("rdp-pan-control")).toBeVisible();
		await page.waitForTimeout(400);
		await travel(cdp, [at(box, 0.17, 0.45), at(box, 0.83, 0.45)], [at(box, 0.5, 0.45), at(box, 0.52, 0.45)]);
		await expect.poll(() => surface.evaluate(element => (element as HTMLElement).style.transform)).toBe("");
		await expect(desktop.getByTestId("rdp-pan-control")).toBeHidden();

		// Direct touch: the pointer goes where the finger is; tap and hold, then release, is a right click.
		await desktop.getByTestId("rdp-pointer-mode").click();
		await expect(desktop.getByTestId("rdp-pointer-mode")).toHaveAccessibleName("直接触摸模式");
		await expect(desktop.getByTestId("rdp-touch-hint")).toContainText("轻点并按住后松开＝右键");
		sent.length = 0;
		await tap(cdp, [at(box, 0.14, 0.3)]);
		await expect.poll(() => mice(sent).some(m => m.mask === 1)).toBe(true);
		const pressed = mice(sent).find(m => m.mask === 1)!;
		expect(Math.abs(pressed.x - 0.14 * 1280)).toBeLessThanOrEqual(3);
		expect(Math.abs(pressed.y - 0.3 * 720)).toBeLessThanOrEqual(3);
		await page.waitForTimeout(400);
		sent.length = 0;
		await touchDown(cdp, [at(box, 0.22, 0.45)]);
		await expect(desktop.getByTestId("rdp-hold-ring")).toBeVisible();
		await touchUp(cdp);
		await expect.poll(() => mice(sent).some(m => m.mask === 4)).toBe(true);
	});
});

test("the keyboard button raises and lowers the on-screen keyboard, with the extra keys above it", async ({ browser, browserName, baseURL }) => {
	test.skip(browserName !== "chromium", "touch input is driven through Chromium's DevTools protocol");
	test.setTimeout(120_000);
	await withRdpPhone(browser, baseURL, async ({ page, desktop, cdp, sent, box }) => {
		const chip = desktop.getByTestId("rdp-keyboard");
		const field = desktop.getByRole("textbox", { name: "远程桌面键盘输入" });
		await expect(chip).toHaveAttribute("aria-pressed", "false");

		// Taps on the desktop, in either mode, do not raise the keyboard.
		await tap(cdp, [at(box, 0.3, 0.3)]);
		await expect(field).not.toBeFocused();
		await expect(desktop.getByTestId("rdp-extra-keys")).toBeHidden();

		// The button raises it, and a second tap on the same button lowers it (it used to only focus the field).
		await chip.tap();
		await expect(field).toBeFocused();
		await expect(chip).toHaveAttribute("aria-pressed", "true");
		await expect(desktop.getByTestId("rdp-extra-keys")).toBeVisible();
		await page.waitForTimeout(400);
		await tap(cdp, [at(box, 0.3, 0.3)]);
		await expect(field).toBeFocused();
		await chip.tap();
		await expect(field).not.toBeFocused();
		await expect(chip).toHaveAttribute("aria-pressed", "false");
		await expect(desktop.getByTestId("rdp-extra-keys")).toBeHidden();

		// With it up: Esc, and Ctrl armed for the next key only.
		await chip.tap();
		await expect(field).toBeFocused();
		sent.length = 0;
		await desktop.getByTestId("rdp-key-esc").tap();
		await expect.poll(() => keys(sent)).toEqual(["65307:1", "65307:0"]);
		sent.length = 0;
		await desktop.getByTestId("rdp-key-ctrl").tap();
		await expect(desktop.getByTestId("rdp-key-ctrl")).toHaveAttribute("data-state", "armed");
		await desktop.getByTestId("rdp-key-tab").tap();
		await expect.poll(() => keys(sent)).toEqual(["65507:1", "65289:1", "65289:0", "65507:0"]);
		// The extra keys never take the focus off the field, which would lower the keyboard.
		await expect(field).toBeFocused();

		// The keyboard covers half of the panel: the desktop keeps its size meanwhile, and the picture can be panned.
		await page.waitForTimeout(3_000);
		const asked = sizes(sent).length;
		await page.setViewportSize({ width: 390, height: 440 });
		await page.waitForTimeout(900);
		expect(sizes(sent).length).toBe(asked);
		await expect(desktop.getByTestId("rdp-pan-control")).toBeVisible();
		await expect(field).toBeFocused();

		// The system lowers its keyboard (the viewport is whole again): the button follows, and the desktop is fitted.
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(chip).toHaveAttribute("aria-pressed", "false");
		await expect(desktop.getByTestId("rdp-extra-keys")).toBeHidden();
		await expect(desktop.getByTestId("rdp-pan-control")).toBeHidden();
		await expect.poll(() => sizes(sent).length).toBeGreaterThan(asked);
		// And the next tap raises it again rather than "lowering" a keyboard that is already gone.
		await chip.tap();
		await expect(field).toBeFocused();
	});
});

test("the keyboard button and taps behave the same in the WebKit engine (iOS Safari)", async ({ playwright, baseURL }) => {
	test.setTimeout(150_000);
	const webkit = await playwright.webkit.launch();
	try {
		await withRdpPhone(webkit, baseURL, async ({ page, desktop, sent, box }) => {
			const chip = desktop.getByTestId("rdp-keyboard");
			const field = desktop.getByRole("textbox", { name: "远程桌面键盘输入" });
			await expect(field).toHaveAttribute("inputmode", "none");

			// A tap clicks, and does not raise the keyboard.
			await page.touchscreen.tap(...at(box, 0.3, 0.3));
			await expect.poll(() => mice(sent).some(m => m.mask === 1)).toBe(true);
			await expect(field).not.toBeFocused();

			// The button raises it, a tap on the desktop leaves it up, the button lowers it.
			await chip.tap();
			await expect(field).toBeFocused();
			await expect(chip).toHaveAttribute("aria-pressed", "true");
			await expect(desktop.getByTestId("rdp-extra-keys")).toBeVisible();
			await page.waitForTimeout(500);
			await page.touchscreen.tap(...at(box, 0.3, 0.3));
			await expect(field).toBeFocused();
			await chip.tap();
			await expect(field).not.toBeFocused();
			await expect(chip).toHaveAttribute("aria-pressed", "false");
			await expect(desktop.getByTestId("rdp-extra-keys")).toBeHidden();
		}, devices["iPhone 13"]);
	} finally {
		await webkit.close();
	}
});
