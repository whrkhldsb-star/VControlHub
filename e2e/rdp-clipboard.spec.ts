import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";
import { GuacParser, instruction } from "../src/lib/rdp/protocol";

test.use({ serviceWorkers: "block" });

test("RDP native text paste and Linux/Windows connection control dimensions", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  // Own the fixture in the existing isolated E2E workspace, never a real VPS.
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const prefix = `rdp-input-${randomUUID()}`;
  try {
    const account = await db.query('SELECT "currentTeamId" FROM "User" WHERE username = $1', [process.env.E2E_USER]);
    const teamId = account.rows[0].currentTeamId;
    for (const os of ["LINUX", "WINDOWS"]) {
      await db.query(`INSERT INTO servers (id,name,host,port,username,password,"rdpPassword",tags,enabled,"connectionType","operatingSystem","teamId","createdAt","updatedAt")
        VALUES ($1,$1,'192.0.2.1',$2,'fixture',CASE WHEN $4 = 'WINDOWS' THEN NULL ELSE 'unused' END,'unused',ARRAY[$3],true,'PASSWORD',$4,$5,NOW(),NOW())`,
      [prefix + os, os === "WINDOWS" ? 3389 : 22, prefix, os, teamId]);
    }
    await db.query(`INSERT INTO "StorageNode" (id,name,driver,"basePath","serverId","teamId","createdAt","updatedAt") VALUES ($1,$1,'LOCAL','/tmp/rdp-input-unused',$2,$3,NOW(),NOW())`, [prefix, prefix + "WINDOWS", teamId]);
    await installDirectSession(context);
    await page.goto(`/servers?query=${prefix}`, { waitUntil: "networkidle" });
    const cards = page.locator("[data-server-card]");
    await expect(cards).toHaveCount(2);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const rdp = cards.locator('[data-server-connection="rdp"]');
      const ssh = cards.locator('[data-server-connection="ssh"]');
      await expect(rdp).toBeVisible();
      await expect(ssh).toBeVisible();
      const a = await rdp.boundingBox(), b = await ssh.boundingBox();
      expect(a!.height).toBe(b!.height);
      expect(a!.width).toBe(b!.width);
      await page.screenshot({ path: testInfo.outputPath(`connection-controls-${width}.png`) });
    }
    const windows = cards.filter({ hasText: prefix + "WINDOWS" });
    await windows.getByRole("button", { name: /查看详情|View details/i }).click();
    const dialog = page.getByRole("dialog", { name: prefix + "WINDOWS" });
    const rdp = dialog.locator('[data-server-connection="rdp"]');
    const ssh = dialog.locator('[data-server-connection="ssh"]');
    await expect(rdp).toBeVisible();
    await expect(ssh).toBeVisible();
    const a = await rdp.boundingBox(), b = await ssh.boundingBox();
    expect(a!.height).toBe(b!.height);
    expect(a!.width).toBe(b!.width);
    await page.keyboard.press("Escape");

    // Exercise the real browser keyboard, clipboard event and Guacamole client;
    // substitute only the remote transport, so no test types into a real desktop.
    await page.route("**/api/auth/rdp-ticket", route => route.fulfill({ json: { token: "fixture-ticket", path: "/rdp" } }));
    const pasted: string[] = [];
    let clipboard = "", chunks: Buffer[] = [], control = false;
    await page.routeWebSocket(/\/rdp$/, ws => {
      const parser = new GuacParser(row => {
        if (row[0] === "clipboard") chunks = [];
        if (row[0] === "blob") chunks.push(Buffer.from(row[2]!, "base64"));
        if (row[0] === "end") clipboard = Buffer.concat(chunks).toString("utf8");
        if (row[0] === "key" && row[1] === "65507") control = row[2] === "1";
        if (row[0] === "key" && row[1] === "118" && row[2] === "1" && control) pasted.push(clipboard);
        if (row[0] === "") ws.send(instruction(...row));
      });
      ws.onMessage(data => {
        if (data === "fixture-ticket") ws.send(instruction("", "fixture") + instruction("size", "0", "640", "480") + instruction("sync", "1"));
        else parser.feed(String(data));
      });
    });
    await page.goto(`/servers/${prefix}WINDOWS/remote-desktop`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /连接 \/ 重新连接|Connect \/ Reconnect/ }).click();
    await expect(page.getByRole("status").filter({ hasText: /已连接|^Connected$/ })).toBeVisible();
    await page.evaluate(() => {
      const source = document.createElement("textarea");
      source.id = "local-copy-source";
      source.setAttribute("aria-label", "Local copy source");
      document.body.appendChild(source);
    });
    const source = page.getByRole("textbox", { name: "Local copy source" });
    for (const text of ["中文 🙂 first paste", "第二次\n" + "多行🙂".repeat(1500)]) {
      await source.fill(text);
      await source.focus();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("ControlOrMeta+C");
      await page.getByRole("application").click({ position: { x: 20, y: 20 } });
      await page.keyboard.press("ControlOrMeta+V");
      await expect.poll(() => pasted.at(-1)).toBe(text);
    }
    expect(pasted).toHaveLength(2);
    expect(pageErrors).toEqual([]);
    await expect(page.getByRole("textbox", { name: /远程桌面键盘输入|Remote desktop keyboard input/ })).toHaveValue("");
    await page.getByRole("button", { name: /断开连接|Disconnect/ }).click();
  } finally {
    await db.query('DELETE FROM "StorageNode" WHERE id=$1', [prefix]);
    await db.query('DELETE FROM servers WHERE id=ANY($1::text[])', [[prefix + "LINUX", prefix + "WINDOWS"]]);
    await db.end();
  }
});
