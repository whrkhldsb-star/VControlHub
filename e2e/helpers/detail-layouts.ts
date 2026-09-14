import { expect, type Page, type TestInfo } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(`${process.cwd()}/package.json`);

/** Exercise a real fixture detail without changing the workflow's own context. */
export async function inspectDetailLayouts(source: Page, testInfo: TestInfo, name: string) {
  if (process.env.UI_DETAIL_MATRIX !== "1") return;
  const browser = source.context().browser()!;
  const storageState = await source.context().storageState();
  if (name === "public-share") {
    const sessionCookieName = await source.locator('meta[name="session-cookie-name"]').getAttribute("content");
    storageState.cookies = storageState.cookies.filter(({ name }) => name !== sessionCookieName);
  }
  for (const locale of ["zh", "en"]) for (const theme of ["dark", "light"]) for (const width of [320, 768, 1440]) {
    const context = await browser.newContext({ storageState, viewport: { width, height: 900 } });
    await context.addCookies([
      { name: "vps-locale", value: locale, url: source.url() },
      { name: "vps-theme", value: theme, url: source.url() },
    ]);
    await context.addInitScript(({ locale, theme }) => {
      localStorage.setItem("vps-locale", locale); localStorage.setItem("vps-theme", theme);
    }, { locale, theme });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      expect((await page.goto(source.url()))?.status()).toBeLessThan(400);
      await expect(page.locator("h1").first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
        return (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations
          .map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
      });
      expect.soft(violations, `${name} ${locale} ${theme} ${width}`).toEqual([]);
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      expect.soft(errors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${locale}-${theme}-${width}.png`), fullPage: true });
    } finally { await context.close(); }
  }
}
