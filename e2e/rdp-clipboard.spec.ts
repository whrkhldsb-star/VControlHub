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
    // Real xterm + browser event pipeline; the transport records input only.
    // Two mobile keyCode-229 punctuation events in one task used to schedule
    // overlapping textarea diffs and replay old command text.
    await page.route("**/api/auth/ws-token", route => route.fulfill({ json: { token: "fixture-token" } }));
    const terminalInput: string[] = [];
    await page.routeWebSocket(/\/ssh\?/, ws => {
      ws.send(JSON.stringify({ type: "connected", inputAck: true }));
      ws.onMessage(raw => {
        const message = JSON.parse(String(raw));
        if (message.type === "input") {
          terminalInput.push(Buffer.from(message.data, "base64").toString("utf8"));
          ws.send(JSON.stringify({ type: "input-ack", id: message.id }));
        }
      });
    });
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

    await cards.filter({ hasText: prefix + "LINUX" }).locator('[data-server-connection="ssh"]').click();
    const terminal = page.locator(".xterm-helper-textarea");
    await expect(terminal).toBeAttached();
    await terminal.focus();
    await page.keyboard.type("echo ");
    await terminal.evaluate(textarea => {
      const target = textarea as HTMLTextAreaElement;
      target.value = "previous command";
      for (const data of ["（", "）", "[", "]", "，", " "]) {
        target.dispatchEvent(new KeyboardEvent("keydown", { key: "Process", keyCode: 229, bubbles: true }));
        target.value = "previous command" + data;
        target.dispatchEvent(new InputEvent("input", { inputType: "insertText", data, bubbles: true, composed: true }));
      }
    });
    await page.keyboard.type("done");
    await expect.poll(() => terminalInput.join("")).toBe("echo （）[]， done");
    await page.goto(`/servers?query=${prefix}`, { waitUntil: "networkidle" });

    // Exercise the real browser keyboard, clipboard event and Guacamole client;
    // substitute only the remote transport, so no test types into a real desktop.
    await page.route("**/api/auth/rdp-ticket", route => route.fulfill({ json: { token: "fixture-ticket", path: "/rdp" } }));
    const pasted: string[] = [];
    const pressed: number[] = [];
    let clipboard = "", chunks: Buffer[] = [], control = false;
    await page.routeWebSocket(/\/rdp(?:\?|$)/, ws => {
      const parser = new GuacParser(row => {
        if (row[0] === "clipboard") chunks = [];
        if (row[0] === "blob") chunks.push(Buffer.from(row[2]!, "base64"));
        if (row[0] === "end") clipboard = Buffer.concat(chunks).toString("utf8");
        if (row[0] === "key" && row[1] === "65507") control = row[2] === "1";
        if (row[0] === "key" && row[1] === "118" && row[2] === "1" && control) pasted.push(clipboard);
        if (row[0] === "key" && row[2] === "1") pressed.push(Number(row[1]));
        if (row[0] === "") ws.send(instruction(...row));
      });
      ws.onMessage(data => {
        if (data === "fixture-ticket") ws.send(instruction("", "fixture") + instruction("size", "0", "640", "480") + instruction("sync", "1"));
        else parser.feed(String(data));
      });
    });
    // The old address opens a tab in the session workbench, which connects by itself.
    await page.goto(`/servers/${prefix}WINDOWS/remote-desktop`, { waitUntil: "networkidle" });
    await page.waitForURL(/\/servers$/);
    const desktop = page.getByTestId(`rdp-panel-${prefix}WINDOWS`);
    await expect(desktop.getByRole("status").filter({ hasText: /已连接|^Connected$/ })).toBeVisible();
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
    const field = page.getByRole("textbox", { name: /远程桌面键盘输入|Remote desktop keyboard input/ });
    await expect(field).toHaveValue("");
    // The remote input method (the default) keeps the focus on the desktop
    // itself: a focused text field let the local input method compose too.
    await page.getByRole("application").click({ position: { x: 20, y: 20 } });
    await expect(page.getByRole("application")).toBeFocused();

    if (testInfo.project.name === "chromium") {
      // Chromium can drive an input method (CDP). The local one composes the
      // whole word and only the finished text reaches Windows: clearing the
      // field mid-composition used to leak the later letters to Windows' own
      // input method, and a directly committed "，" after a word was lost.
      await desktop.getByTestId("rdp-input-method").click();
      await page.getByRole("application").click({ position: { x: 20, y: 20 } });
      await expect(field).toBeFocused();
      const cdp = await context.newCDPSession(page);
      pressed.length = 0;
      let composition = "";
      for (const letter of "nihao") {
        composition += letter;
        const code = `Key${letter.toUpperCase()}`;
        await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: 229, key: "Process", code });
        await cdp.send("Input.imeSetComposition", { text: composition, selectionStart: composition.length, selectionEnd: composition.length });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: letter.toUpperCase().charCodeAt(0), key: letter, code });
      }
      await expect(field).toHaveValue("nihao");
      await cdp.send("Input.insertText", { text: "你好" });
      await cdp.send("Input.insertText", { text: "，" });
      await expect.poll(() => pressed.map(key => String.fromCodePoint(key & 0xffffff)).join("")).toBe("你好，");
      await expect(field).toHaveValue("");
      await desktop.getByTestId("rdp-input-method").click();
    }

    // Several sessions stay switchable, in the window and in full screen
    // (full screen hid the tab bar, and browsers keep Ctrl+Tab for their own tabs).
    await page.getByTestId("ssh-terminal-minimize").click();
    await cards.filter({ hasText: prefix + "LINUX" }).locator('[data-server-connection="ssh"]').click();
    const pill = page.getByTestId("ssh-terminal-minimized-pill");
    if (await pill.isVisible()) await pill.click();
    const terminalPanel = page.getByTestId(`ssh-terminal-panel-${prefix}LINUX`);
    const sessions = page.getByRole("tablist", { name: /远程会话|Remote sessions/ });
    await expect(sessions.getByRole("tab")).toHaveCount(2);
    await sessions.getByRole("tab", { name: new RegExp(prefix + "WINDOWS") }).click();
    await expect(desktop).toBeVisible();
    await expect(terminalPanel).toBeHidden();
    await sessions.getByRole("tab", { name: new RegExp(prefix + "LINUX") }).click();
    await expect(terminalPanel).toBeVisible();
    await expect(desktop).toBeHidden();
    await sessions.getByRole("tab", { name: new RegExp(prefix + "WINDOWS") }).click();
    await desktop.getByTestId("rdp-fullscreen-enter").click();
    const strip = page.getByTestId("ssh-terminal-fullscreen-tabs");
    await expect(strip).toBeVisible();
    await strip.getByRole("tab", { name: new RegExp(prefix + "LINUX") }).click();
    await expect(terminalPanel).toBeVisible();
    await expect(desktop).toBeHidden();
    await strip.getByRole("tab", { name: new RegExp(prefix + "WINDOWS") }).click();
    await expect(desktop).toBeVisible();
    await desktop.getByTestId("rdp-fullscreen-exit").click();
    await expect(strip).toHaveCount(0);

    expect(pageErrors).toEqual([]);
    await desktop.getByRole("button", { name: /关闭远程桌面|Close remote desktop/ }).click();
    await expect(desktop).toHaveCount(0);
  } finally {
    await db.query('DELETE FROM "StorageNode" WHERE id=$1', [prefix]);
    await db.query('DELETE FROM servers WHERE id=ANY($1::text[])', [[prefix + "LINUX", prefix + "WINDOWS"]]);
    await db.end();
  }
});
