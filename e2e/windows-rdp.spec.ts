import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";

// Opt-in production canary: no real credentials, account changes or remote connections.
test("Windows/Linux create controls and isolated inventory filters", async ({ page, context }) => {
  test.skip(process.env.E2E_RDP_CANARY !== "1", "Requires explicit local fixture permission");
  await installDirectSession(context);
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Local database required");
  const db = new Client({ connectionString: url.toString() });
  const prefix = `rdp-canary-${randomUUID()}`;
  await db.connect();
  try {
    for (const os of ["LINUX", "WINDOWS"]) {
      await db.query(`INSERT INTO servers (id,name,host,port,username,tags,enabled,"connectionType","operatingSystem","createdAt","updatedAt") VALUES ($1,$1,'192.0.2.1',$2,'fixture',ARRAY[$3],false,'PASSWORD',$4,NOW(),NOW())`, [prefix + os, os === "WINDOWS" ? 3389 : 22, prefix, os]);
    }
    await page.goto(`/servers?query=${prefix}`);
    await expect(page.locator("[data-server-card]")).toHaveCount(2);
    await page.getByRole("tab", { name: "Windows", exact: true }).click();
    await expect(page).toHaveURL(/operatingSystem=WINDOWS/);
    await expect(page.locator("[data-server-card]")).toHaveCount(1);
    await expect(page.locator("[data-server-card]")).toContainText(prefix + "WINDOWS");
    await page.reload();
    await expect(page.getByRole("tab", { name: "Windows", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Linux", exact: true }).click();
    await expect(page.locator("[data-server-card]")).toHaveCount(1);
    await expect(page.locator("[data-server-card]")).toContainText(prefix + "LINUX");
    await page.goto("/servers#servers-create");
    const os = page.locator("#serverOperatingSystem");
    await expect(os).toHaveValue("LINUX");
    await expect(page.locator("#serverPort")).toHaveValue("22");
    await os.selectOption("WINDOWS");
    await expect(page.locator("#serverPort")).toHaveValue("3389");
    await expect(page.locator('[name="rdpPassword"]')).toHaveAttribute("type", "password");
    await expect(page.locator('[name="rdpPassword"]')).toHaveAttribute("required", "");
    await expect(page.locator('[name="username"]')).toHaveValue("Administrator");
    await expect(page.locator('[name="connectionType"]')).toHaveCount(0);
    await os.selectOption("LINUX");
    await expect(page.locator("#serverPort")).toHaveValue("22");
    await expect(page.locator('[name="rdpPassword"]')).toHaveCount(0);
    await expect(page.locator('[name="connectionType"]')).not.toHaveCount(0);
  } finally {
    await db.query('DELETE FROM servers WHERE id = ANY($1::text[])', [[prefix + "LINUX", prefix + "WINDOWS"]]);
    const result = await db.query('SELECT count(*)::int AS count FROM servers WHERE id = ANY($1::text[])', [[prefix + "LINUX", prefix + "WINDOWS"]]);
    await db.end();
    expect(result.rows[0].count).toBe(0);
  }
});

test("Windows/Linux create form toggles RDP and SSH fields", async ({ page, context }) => {
  await installDirectSession(context);
  await page.goto("/servers#servers-create");
  const os = page.locator("#serverOperatingSystem");
  await expect(os).toHaveValue("LINUX");
  await expect(page.locator("#serverPort")).toHaveValue("22");
  await os.selectOption("WINDOWS");
  await expect(page.locator("#serverPort")).toHaveValue("3389");
  await expect(page.locator('[name="rdpPassword"]')).toHaveAttribute("type", "password");
  await expect(page.locator('[name="username"]')).toHaveValue("Administrator");
  await expect(page.locator('[name="connectionType"]')).toHaveCount(0);
  await os.selectOption("LINUX");
  await expect(page.locator("#serverPort")).toHaveValue("22");
  await expect(page.locator('[name="rdpPassword"]')).toHaveCount(0);
});

test("RDP ticket rejects missing session and cross-origin requests", async ({ context, request }) => {
  // Local transport may target production; retain its configured public Host/Origin.
  // This is test routing only: never add loopback to the production allowlist.
  const origin = new URL(process.env.E2E_RDP_ORIGIN ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000").origin;
  const routing = { host: new URL(origin).host, "x-forwarded-proto": new URL(origin).protocol.slice(0, -1) };
  const anonymous = await request.post("/api/auth/rdp-ticket", { data: { serverId: "missing" }, headers: { ...routing, origin } });
  expect([401, 403]).toContain(anonymous.status());
  await installDirectSession(context);
  const csrf = (await context.cookies()).find(c => c.name === "csrf_token")!.value;
  const denied = await context.request.post("/api/auth/rdp-ticket", { data: { serverId: "missing" }, headers: { ...routing, origin: "https://invalid.example", "x-csrf-token": csrf } });
  expect(denied.status()).toBe(403);
  const missing = await context.request.post("/api/auth/rdp-ticket", { data: { serverId: "rdp-canary-does-not-exist" }, headers: { ...routing, origin, "x-csrf-token": csrf } });
  expect(missing.status(), await missing.text()).toBe(404);
});
