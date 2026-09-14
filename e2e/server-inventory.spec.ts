import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";

test("server inventory searches beyond 500 nodes and restores URL pagination", async ({ page, context }) => {
  test.setTimeout(120_000);
  await installDirectSession(context);
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.E2E_ISOLATED_ACCOUNT !== "1" || !["127.0.0.1", "localhost"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) throw new Error("Isolated audit database required");
  const prefix = `inventory-e2e-${randomUUID()}`;
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  try {
    await db.query(`INSERT INTO servers (id,name,host,port,username,tags,enabled,"connectionType","createdAt","updatedAt")
      SELECT $1 || lpad(n::text,4,'0'), $1 || n, '192.0.2.1',22,'fixture',ARRAY[$1, CASE WHEN n=1 THEN 'Unique生产%_' ELSE 'ordinary' END],false,'PASSWORD',NOW(),NOW()
      FROM generate_series(1,513) n`, [prefix]);
    await page.goto(`/servers?query=${prefix}`);
    await page.evaluate(async () => {
      if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
    });
    await expect(page.locator("[data-server-card]")).toHaveCount(12);
    await page.getByRole("button", { name: /下一页|^Next$/ }).click();
    await expect(page).toHaveURL(/page=2/);
    const search = page.getByRole("searchbox", { name: /搜索名称|Search name/ });
    await search.fill("Unique生产%_");
    await search.press("Enter");
    await expect(page.locator("[data-server-card]")).toHaveCount(1);
    await page.goBack();
    await expect(page.getByRole("spinbutton", { name: /页码|Page number/ })).toHaveValue("2");
    await page.reload();
    await expect(page.getByRole("spinbutton", { name: /页码|Page number/ })).toHaveValue("2");
    await search.fill("Unique生产%_");
    await search.press("Enter");
    await expect(page.locator("[data-server-card]")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: `${prefix}1`, exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("spinbutton", { name: /页码|Page number/ })).toHaveValue("2");
    await expect(search).toHaveValue(prefix);
    await page.goto(`/servers?query=${prefix}&page=9999`);
    await expect(page.getByRole("spinbutton", { name: /页码|Page number/ })).toHaveValue("43");
    await expect(page.locator("[data-server-card]")).toHaveCount(9);
    await page.getByRole("tab", { name: /批量操作|Batch/ }).click();
    await expect(page.getByRole("checkbox", { name: new RegExp(`${prefix}1(?:\\s|$)`) }).first()).toBeVisible();
  } finally {
    await db.query('DELETE FROM servers WHERE id LIKE $1', [`${prefix}%`]);
    await db.end();
  }
});
