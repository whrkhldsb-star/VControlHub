import { expect, test, type Request } from "@playwright/test";
import { Client } from "pg";
import { createRequire } from "node:module";
import { installDirectSession } from "./helpers/direct-session";

const nodeRequire = createRequire(`${process.cwd()}/package.json`);
const fixturePrefix = "e2e-ui-upgrade-";

// These visual fixtures intercept diagnostics. Keep service workers out of the
// interception path; server-inventory/authenticated-flow cover normal PWA use.
test.use({ serviceWorkers: "block" });

async function fixtures(create: boolean) {
  try { process.loadEnvFile(".env.local"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.E2E_ISOLATED_ACCOUNT !== "1" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    || !/(audit|test|_ci)/i.test(url.pathname)) throw new Error("UI fixtures require an isolated audit/test database");
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query('DELETE FROM servers WHERE id LIKE $1', [`${fixturePrefix}%`]);
    if (create) await client.query(`INSERT INTO servers (id, name, host, port, username, password, tags, enabled, "connectionType", "managementMode", "createdAt", "updatedAt")
      SELECT $1 || n, 'UI sample ' || lpad(n::text, 2, '0'), '192.0.2.' || n, 22, 'root', 'e2e-unused', ARRAY['ui-sample', CASE WHEN n = 25 THEN 'unique-tag' ELSE 'standard' END],
      n % 2 = 0, 'PASSWORD', 'DIRECT', NOW(), NOW() FROM generate_series(1,25) n`, [fixturePrefix]);
  } finally { await client.end(); }
}

test.beforeAll(async () => { await fixtures(true); });
test.afterAll(async () => { await fixtures(false); });
test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined }));
  await installDirectSession(context);
  // Visual fixtures use deterministic metrics; real diagnostics remain covered
  // by remaining-user-workflows.spec.ts and the request-lifecycle unit tests.
  await page.route("**/api/servers/monitor?**", (route) => route.fulfill({ json: {
    cpu: { usagePercent: 12 }, memory: { usagePercent: 40 }, disk: [{ mount: "/", usagePercent: 32 }],
  } }));
});

test("inventory filters span all pages and keyboard tabs have named panels", async ({ page }) => {
  await page.goto("/servers");
  const search = page.getByRole("searchbox", { name: /搜索名称|Search name/ });
  await search.fill("ui-sample");
  await search.press("Enter");
  await expect(page).toHaveURL(/query=ui-sample/);
  await expect(page.locator("[data-server-card]")).toHaveCount(12);
  await page.getByRole("button", { name: /下一页|^Next$/ }).click();
  await expect(page.getByRole("spinbutton", { name: /页码|Page number/ })).toHaveValue("2");
  await search.fill("unique-tag");
  await search.press("Enter");
  await expect(page).toHaveURL(/query=unique-tag/);
  await expect(page.locator("[data-server-card]")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "UI sample 25" })).toBeVisible();
  await page.getByRole("combobox", { name: /节点状态|Node status/ }).selectOption("enabled");
  await expect(page.locator("[data-server-card]")).toHaveCount(0);
  await page.getByRole("button", { name: /清除筛选|Clear filters/ }).click();
  await expect(page.locator("[data-server-card]")).toHaveCount(12);
  const tabs = page.getByRole("tablist", { name: /VPS|actions/i }).getByRole("tab");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(page.getByRole("tabpanel")).toHaveAccessibleName(/命令下发|command/i);
});

test("settings bookmarks, drafts and mobile category navigation remain consistent", async ({ page }) => {
  await page.goto("/settings#platform");
  const name = page.getByLabel(/平台名称|Platform name/);
  await expect(name).toBeVisible();
  await name.fill("UI unsaved draft");
  await page.getByRole("tab", { name: /个人偏好|Personal/ }).click();
  await page.getByRole("tab", { name: /安全与账户|Security/ }).click();
  await expect(name).toHaveValue("UI unsaved draft");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: /高级配置|Advanced/ }).click();
  await page.getByRole("combobox", { name: /分类|categor/i }).selectOption("system-config");
  await expect(page).toHaveURL(/#system-config$/);
  await expect(page.locator("#system-config")).toBeInViewport();
});

for (const locale of ["zh", "en"]) for (const theme of ["dark", "light"]) for (const width of [320, 768, 1440]) {
  test(`representative pages ${locale} ${theme} ${width}px`, async ({ browser, context }, testInfo) => {
    test.setTimeout(120_000);
    await context.addCookies([{ name: "vps-locale", value: locale, url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000" }]);
    const storageState = await context.storageState();
    const errors: string[] = [];
    for (const route of ["servers", "files", "settings", "monitoring"]) {
      const routeContext = await browser.newContext({ storageState, serviceWorkers: "block", baseURL: testInfo.project.use.baseURL, viewport: { width, height: 900 }, reducedMotion: "reduce" });
      await routeContext.addInitScript(({ locale, theme }) => {
        Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
        localStorage.setItem("vps-locale", locale);
        localStorage.setItem("vps-theme", theme);
      }, { locale, theme });
      const page = await routeContext.newPage();
      page.on("pageerror", (error) => errors.push(`${route}: ${error.message}`));
      const pending = new Set<Request>();
      let changedAt = Date.now();
      page.on("request", (request) => { if (request.resourceType() !== "eventsource") { pending.add(request); changedAt = Date.now(); } });
      const finished = (request: Request) => { if (pending.delete(request)) changedAt = Date.now(); };
      page.on("requestfinished", finished);
      page.on("requestfailed", finished);
      await page.route("**/api/servers/monitor?**", (request) => request.fulfill({ json: {
        cpu: { usagePercent: 12 }, memory: { usagePercent: 40 }, disk: [{ mount: "/", usagePercent: 32 }],
      } }));
      try {
      await page.goto(`/${route}`);
      await page.evaluate(() => document.fonts.ready);
      if (route === "servers") {
        const search = page.getByRole("searchbox", { name: /搜索名称|Search name/ });
        await search.fill("ui-sample");
        await search.press("Enter");
        await expect(page).toHaveURL(/query=ui-sample/);
        await expect(page.locator("[data-server-card]")).toHaveCount(12);
      } else if (route === "settings") {
        await page.getByRole("tab", { name: /高级配置|Advanced/ }).click();
      } else if (route === "monitoring") {
        await expect(page.getByRole("button", { name: /^刷新$|^Refresh$/ })).toBeEnabled();
      } else {
        await expect(page.locator("[data-file-browser]")).toBeVisible();
      }
      await expect.poll(() => pending.size === 0 && Date.now() - changedAt >= 500, { timeout: 30_000 }).toBe(true);
      await page.evaluate((theme) => document.documentElement.classList.toggle("light", theme === "light"), theme);
      // Reduced motion collapses color transitions, but keep an explicit settle
      // so axe never samples a mid-transition frame after the theme toggle.
      await page.waitForTimeout(250);
      await page.addScriptTag({ path: nodeRequire.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
        const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
        return result.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) }));
      });
      expect.soft(violations, `${route} accessibility`).toEqual([]);
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${route} overflow`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`${route}-${locale}-${theme}-${width}.png`) });
      if (route === "servers" && width === 320) {
        await page.locator("[data-toolbar]").evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().top + scrollY - 80));
        await page.screenshot({ path: testInfo.outputPath(`${route}-toolbar-${locale}-${theme}-${width}.png`) });
      }
      } finally { await routeContext.close(); }
    }
    expect(errors).toEqual([]);
  });
}
