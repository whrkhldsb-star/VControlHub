import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test, type CDPSession } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";
import { GuacParser, instruction } from "../src/lib/rdp/protocol";

test.use({ serviceWorkers: "block" });

/**
 * A phone has no mouse: a finger drag used to scroll the page and the remote
 * pointer never moved. Real Chromium touch input (CDP) against the real
 * Guacamole client; only the RDP transport is a fixture, which records what
 * the remote desktop would receive.
 */
test("a finger moves, clicks and right-clicks the remote pointer on a phone", async ({ browser, browserName, baseURL }) => {
  test.skip(browserName !== "chromium", "touch input is driven through Chromium's DevTools protocol");
  test.setTimeout(90_000);
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const id = `rdp-touch-${randomUUID()}`;
  try {
    const account = await db.query('SELECT "currentTeamId" FROM "User" WHERE username = $1', [process.env.E2E_USER]);
    await db.query(`INSERT INTO servers (id,name,host,port,username,"rdpPassword",tags,enabled,"connectionType","operatingSystem","teamId","createdAt","updatedAt")
      VALUES ($1,$1,'192.0.2.1',3389,'fixture','unused',ARRAY[$1],true,'PASSWORD','WINDOWS',$2,NOW(),NOW())`, [id, account.rows[0].currentTeamId]);
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "zh-CN" });
    await installDirectSession(context);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.route("**/api/auth/rdp-ticket", route => route.fulfill({ json: { token: "fixture-ticket", path: "/rdp" } }));
    const mice: Array<{ x: number; y: number; mask: number }> = [];
    await page.routeWebSocket(/\/rdp$/, ws => {
      const parser = new GuacParser(row => {
        if (row[0] === "mouse") mice.push({ x: Number(row[1]), y: Number(row[2]), mask: Number(row[3]) });
        if (row[0] === "") ws.send(instruction(...row));
      });
      ws.onMessage(data => {
        if (data === "fixture-ticket") ws.send(instruction("", "fixture") + instruction("size", "0", "1280", "720") + instruction("sync", "1"));
        else parser.feed(String(data));
      });
    });
    await page.goto(`/servers/${id}/remote-desktop`, { waitUntil: "networkidle" });
    const desktop = page.getByTestId(`rdp-panel-${id}`);
    await expect(desktop.getByRole("status").filter({ hasText: "已连接" })).toBeVisible();
    await expect(desktop.getByTestId("rdp-pointer-mode")).toHaveAccessibleName("触控板模式");
    const box = (await desktop.getByRole("application").boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);

    // Touchpad (default): the pointer starts in the middle of the 1280 × 720 desktop and a drag moves it.
    await expect.poll(() => mice.length).toBeGreaterThan(0);
    const start = mice.at(-1)!;
    expect(Math.abs(start.x - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(start.y - 360)).toBeLessThanOrEqual(2);
    mice.length = 0;
    await drag(cdp, box.x + 100, box.y + 100, box.x + 160, box.y + 140);
    await expect.poll(() => mice.length).toBeGreaterThan(2);
    const moved = mice.at(-1)!;
    expect(moved.mask).toBe(0);
    expect(moved.x).toBeGreaterThan(start.x);
    expect(moved.y).toBeGreaterThan(start.y);
    // The page itself did not scroll under the finger.
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    // A tap clicks where the pointer is; a two-finger tap right-clicks.
    mice.length = 0;
    await tap(cdp, [[box.x + 200, box.y + 200]]);
    await expect.poll(() => mice.some(m => m.mask === 1)).toBe(true);
    expect(mice.filter(m => m.mask === 1).every(m => m.x === moved.x && m.y === moved.y)).toBe(true);
    // A tap's release waits out the tap-and-drag window (250 ms) before the next gesture.
    await page.waitForTimeout(400);
    mice.length = 0;
    await tap(cdp, [[box.x + 120, box.y + 120], [box.x + 160, box.y + 120]]);
    await expect.poll(() => mice.some(m => m.mask === 4)).toBe(true);

    // Touch mode: the pointer goes where the finger is.
    await desktop.getByTestId("rdp-pointer-mode").click();
    await expect(desktop.getByTestId("rdp-pointer-mode")).toHaveAccessibleName("触控模式");
    await expect(desktop.getByTestId("rdp-touch-hint")).toContainText("指针跟随手指");
    mice.length = 0;
    await tap(cdp, [[box.x + 50, box.y + 60]]);
    await expect.poll(() => mice.some(m => m.mask === 1)).toBe(true);
    const pressed = mice.find(m => m.mask === 1)!;
    expect(Math.abs(pressed.x - moved.x) + Math.abs(pressed.y - moved.y)).toBeGreaterThan(20);

    // The keyboard chip opens the on-screen keyboard (focuses the input).
    await desktop.getByTestId("rdp-keyboard").click();
    await expect(desktop.getByRole("textbox", { name: "远程桌面键盘输入" })).toBeFocused();
    expect(pageErrors).toEqual([]);
    await context.close();
  } finally {
    await db.query("DELETE FROM servers WHERE id=$1", [id]);
    await db.end();
  }
});

async function drag(cdp: CDPSession, fromX: number, fromY: number, toX: number, toY: number) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: fromX, y: fromY }] });
  for (let step = 1; step <= 8; step += 1) {
    const x = fromX + ((toX - fromX) * step) / 8, y = fromY + ((toY - fromY) * step) / 8;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function tap(cdp: CDPSession, points: Array<[number, number]>) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points.map(([x, y]) => ({ x, y })) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

