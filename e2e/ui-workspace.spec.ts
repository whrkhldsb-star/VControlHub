import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { installDirectSession } from "./helpers/direct-session";

test("AI conversation controls and drafts remain usable across layouts", async ({ page, context, browser, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  await installDirectSession(context);
  const csrf = (await context.cookies()).find(({ name }) => name === "csrf_token")!.value;
  const headers = { "X-CSRF-Token": csrf };
  const created = await page.request.post("/api/ai/providers", { headers, data: {
    name: "UI workspace fixture", type: "OPENAI_COMPATIBLE", apiKey: "unused-fixture-key",
    baseUrl: "https://example.com/v1", defaultModel: "fixture-model", availableModels: ["fixture-model"], isDefault: false,
  } });
  expect(created.ok()).toBe(true);
  const providerId = (await created.json()).provider.id as string;
  const title = "Workspace conversation with a long resource name for incident review";
  try {
    const conversation = await page.request.post("/api/ai/conversations", { headers, data: { title, providerId, model: "fixture-model" } });
    expect(conversation.ok()).toBe(true);
    const storageState = await context.storageState();
    for (const locale of ["zh", "en"]) for (const theme of ["dark", "light"]) for (const width of [320, 768, 1440]) {
      const routeContext = await browser.newContext({ storageState, baseURL, viewport: { width, height: 900 } });
      await routeContext.addCookies([
        { name: "vps-locale", value: locale, url: baseURL! }, { name: "vps-theme", value: theme, url: baseURL! },
      ]);
      await routeContext.addInitScript(({ locale, theme }) => {
        localStorage.setItem("vps-locale", locale); localStorage.setItem("vps-theme", theme);
      }, { locale, theme });
      try {
        const view = await routeContext.newPage();
        const errors: string[] = [];
        view.on("pageerror", (error) => errors.push(error.message));
        // Exercise the local conversation UI without contacting an AI provider.
        await view.route("**/api/ai/models?**", (route) => route.fulfill({ json: { models: [] } }));
        await view.goto("/ai");
        if (width < 768) await view.getByRole("button", { name: /查看对话|View conversations/ }).click();
        const select = view.getByRole("button", { name: title, exact: true });
        await select.focus();
        await view.keyboard.press("Enter");
        await expect(view.getByRole("heading", { level: 1, name: title })).toBeVisible();
        const input = view.locator("textarea").last();
        await input.fill("Unsaved incident review draft");
        const settingsBtn = view.locator("[data-action-button][aria-label='设置'], [data-action-button][aria-label='Settings']");
        await settingsBtn.click();
        await settingsBtn.click();
        await expect(input).toHaveValue("Unsaved incident review draft");
        const diag = await input.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          // The composer docks flush ABOVE the fixed bottom nav (z-30, hidden
          // on lg); flush adjacency is correct — only flag if it actually
          // slides UNDER the nav or off any edge. A display:none nav reports
          // rect 0, so ignore non-visible navs.
          const nav = Array.from(document.querySelectorAll<HTMLElement>("nav.fixed.bottom-0"))
            .find((n) => n.offsetParent !== null);
          const navTop = nav ? nav.getBoundingClientRect().top : innerHeight;
          const ok = rect.x >= 0 && rect.right <= innerWidth && rect.y >= 64 && rect.bottom <= Math.min(innerHeight, navTop) + 1;
          return ok ? null : { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom, iw: innerWidth, ih: innerHeight, navTop };
        });
        if (diag) console.log("RECT_FAIL " + JSON.stringify(diag));
        expect(diag).toBeNull();
        await view.evaluate(axe.source);
        const violations = await view.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })));
        expect.soft(violations, `${locale}/${theme}/${width}`).toEqual([]);
        expect.soft(errors).toEqual([]);
        await view.screenshot({ path: testInfo.outputPath(`ai-conversation-${locale}-${theme}-${width}.png`) });
      } finally { await routeContext.close(); }
    }
  } finally {
    expect((await page.request.delete(`/api/ai/providers/${providerId}`, { headers })).ok()).toBe(true);
  }
});
