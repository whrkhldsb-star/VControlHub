import { expect, test, type Request } from "@playwright/test";
import { createRequire } from "node:module";
import catalog from "../docs/route-catalog.json";
import { installDirectSession } from "./helpers/direct-session";

const require = createRequire(`${process.cwd()}/package.json`);
// Aliases and dynamic details are exercised by the product workflow suite.
const aliases = new Set(["/account", "/preferences", "/storage", "/dashboard"]);
const paths = catalog.pages.map(({ path }) => path)
  .filter((path) => !path.includes("[") && !path.startsWith("/login") && !aliases.has(path));
const cases = process.env.UI_FULL_MATRIX === "1"
  ? ["zh", "en"].flatMap((locale) => ["dark", "light"].flatMap((theme) => [320, 768, 1440].map((width) => ({ locale, theme, width }))))
  : [{ locale: "en", theme: "light", width: 320 }, { locale: "zh", theme: "dark", width: 1440 }];

for (const { locale, theme, width } of cases) for (const path of paths) {
  test(`${path} ${locale} ${theme} ${width}px`, async ({ page, context, baseURL }, testInfo) => {
    test.setTimeout(75_000);
    await installDirectSession(context);
    await context.addCookies([
      { name: "vps-locale", value: locale, url: baseURL! },
      { name: "vps-theme", value: theme, url: baseURL! },
    ]);
    await context.addInitScript(({ locale, theme }) => {
      localStorage.setItem("vps-locale", locale);
      localStorage.setItem("vps-theme", theme);
    }, { locale, theme });
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const pending = new Set<Request>();
    let changedAt = Date.now();
    page.on("request", (request) => {
      if (request.resourceType() !== "eventsource") { pending.add(request); changedAt = Date.now(); }
    });
    const finish = (request: Request) => { if (pending.delete(request)) changedAt = Date.now(); };
    page.on("requestfinished", finish);
    page.on("requestfailed", finish);
    // Layout checks do not contact synthetic VPS addresses. Real diagnostics
    // remain in remaining-user-workflows.spec.ts.
    await page.route("**/api/servers/monitor?**", (route) => route.fulfill({ json: {
      cpu: { usagePercent: 12 }, memory: { usagePercent: 40 }, disk: [{ mount: "/", usagePercent: 32 }],
    } }));
    const response = await page.goto(path);
    expect(response?.status()).toBeLessThan(400);
    expect(new URL(page.url()).pathname).not.toBe("/login");
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => pending.size === 0 && Date.now() - changedAt >= 500, { timeout: 30_000 }).toBe(true);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
      const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
      return result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
    });
    expect.soft(violations).toEqual([]);
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const clippedControls = await page.evaluate(() => Array.from(document.querySelectorAll("main button, main input, main select, main textarea"))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height || getComputedStyle(node).visibility === "hidden" || node.closest("[inert], [aria-hidden=true]")) return false;
        if (rect.left >= -1 && rect.right <= innerWidth + 1) return false;
        // Tables, carousels and tab strips may deliberately scroll horizontally.
        for (let parent = node.parentElement; parent && parent.tagName !== "MAIN"; parent = parent.parentElement) {
          if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth) return false;
        }
        return true;
      }).map((node) => ({ tag: node.tagName, name: node.getAttribute("aria-label") || node.textContent?.trim().slice(0, 80) })));
    expect.soft(clippedControls, "controls must fit rather than be clipped by the page").toEqual([]);
    expect.soft(errors).toEqual([]);
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    if (pageHeight <= 30_000) {
      await page.screenshot({ path: testInfo.outputPath("page.png"), fullPage: true });
    } else {
      // Firefox/WebKit cannot capture a bitmap dimension above 32,767px.
      // Preserve the full document in bounded slices without changing its layout.
      await page.screenshot({ path: testInfo.outputPath("page.png") });
      const viewport = page.viewportSize()!;
      for (let top = 0, part = 1; top < pageHeight; top += 16_000, part++) {
        await page.screenshot({
          path: testInfo.outputPath(`page-part-${part}.png`),
          fullPage: true,
          clip: { x: 0, y: top, width: viewport.width, height: Math.min(16_000, pageHeight - top) },
        });
      }
    }
  });
}
