import { expect, test as base, type Locator, type Page } from "@playwright/test";
import axe from "axe-core";
import { installDirectSession } from "./helpers/direct-session";

const test = base.extend({ serviceWorkers: "block" });
const viewports = [
  { width: 320, height: 568 }, { width: 390, height: 844 },
  { width: 768, height: 900 }, { width: 1440, height: 960 }, { width: 844, height: 390 },
];

async function accessibleDialog(page: Page) {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => {
    const runtime = (window as unknown as { axe: typeof axe }).axe;
    const result = await runtime.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    return result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
  });
  expect(violations).toEqual([]);
}

async function fitsViewport(locator: Locator) {
  expect(await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.x >= 0 && box.y >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
  })).toBe(true);
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined }));
  await installDirectSession(context);
});

test("global search keeps keyboard selection and close controls visible", async ({ page, context, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/search?**", (route) => route.fulfill({ json: { results: new URL(route.request().url()).searchParams.get("q") === "empty-results-fixture" ? [] : [{
    label: "Remote result with a long resource name for scanning at narrow widths",
    href: "/servers", category: "Long resource category",
  }] } }));
  for (const [theme, locale] of [["light", "en"], ["dark", "zh"]] as const) {
    await context.addCookies([
      { name: "vps-theme", value: theme, url: baseURL! }, { name: "vps-locale", value: locale, url: baseURL! },
    ]);
    await page.goto("/downloads");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: /全局搜索|Global search/ });
    const input = dialog.getByRole("combobox");
    await expect(input).toBeFocused();
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await input.fill("");
      for (let index = 0; index < 18; index++) await input.press("ArrowDown");
      const selectedId = await input.getAttribute("aria-activedescendant");
      expect(selectedId).toBeTruthy();
      const selected = dialog.locator(`#${selectedId}`);
      await expect(selected).toBeInViewport({ ratio: 1 });
      await fitsViewport(dialog);
      await fitsViewport(dialog.getByRole("button", { name: /关闭|Close/ }));
      expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      if (viewport.width === 320) await accessibleDialog(page);
      await input.fill("remote-fixture");
      await expect(dialog.getByText("Remote result with a long resource name for scanning at narrow widths")).toBeVisible();
      expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`search-${theme}-${viewport.width}x${viewport.height}.png`) });
      if (viewport.width === 320) {
        await input.fill("empty-results-fixture");
        await expect(dialog.getByRole("status")).toBeVisible();
        await expect(input).toHaveAttribute("aria-expanded", "false");
        await accessibleDialog(page);
      }
    }
    await dialog.getByRole("button", { name: /关闭|Close/ }).click();
    await expect(dialog).toBeHidden();
  }
  expect(errors).toEqual([]);
});

test("populated provider forms stay usable at narrow widths and short heights", async ({ page, context, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const csrf = (await context.cookies()).find((cookie) => cookie.name === "csrf_token")!.value;
  const created = await page.request.post("/api/ai/providers", {
    headers: { "X-CSRF-Token": csrf }, data: {
      name: "Dense dialog fixture", type: "OPENAI_COMPATIBLE", apiKey: "fixture-key-unused",
      baseUrl: "https://example.com/v1", defaultModel: "fixture-model", availableModels: ["fixture-model"], isDefault: false,
    },
  });
  expect(created.ok()).toBe(true);
  const json = await created.json();
  const id: string = json.provider.id;
  try {
    for (const [theme, locale] of [["light", "en"], ["dark", "zh"]] as const) {
      await context.addCookies([
        { name: "vps-theme", value: theme, url: baseURL! }, { name: "vps-locale", value: locale, url: baseURL! },
      ]);
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto("/ai");
      await page.getByRole("button", { name: /^(提供商管理|Provider management)$/ }).click();
      const dialog = page.getByRole("dialog", { name: /AI.*(提供商管理|provider management)/ });
      await dialog.getByRole("button", { name: /(?:编辑|Edit) Dense dialog fixture/ }).click();
      await dialog.getByLabel(/^(名称|Name)$/).fill("Dense dialog fixture with a long provider name for repeated operations");
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await fitsViewport(dialog);
        const close = dialog.getByRole("button", { name: /关闭|Close/ }).first();
        await fitsViewport(close);
        const save = dialog.getByRole("button", { name: /保存修改|Save changes/ });
        await save.scrollIntoViewIfNeeded();
        await fitsViewport(save);
        await fitsViewport(close);
        expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
        await page.screenshot({ path: testInfo.outputPath(`provider-${theme}-${viewport.width}x${viewport.height}.png`) });
        if (viewport.width === 320) await accessibleDialog(page);
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    expect(errors).toEqual([]);
  } finally {
    const removed = await page.request.delete(`/api/ai/providers/${id}`, { headers: { "X-CSRF-Token": csrf } });
    expect(removed.ok()).toBe(true);
  }
});

test("long job events preserve fixed controls, pagination and error recovery", async ({ page, context, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let fail = false;
  const makeEvents = (offset: number, count: number) => Array.from({ length: count }, (_, index) => ({
    id: `event-${index + offset}`, jobId: "dense-job", type: "progress", level: index % 3 === 0 ? "error" : "info",
    message: `event-message-${index + offset} ` + "long-output ".repeat(15),
    workerId: "long-worker-".repeat(9), payload: { log: "stdout ".repeat(100) }, createdAt: "2026-09-08T00:00:00Z",
  }));
  await page.route("**/api/operation-tasks?**", (route) => route.fulfill({ json: {
    tasks: [{ id: "job:dense-job", source: "job", sourceId: "dense-job", title: "Dense log fixture", status: "completed", eventCount: 101, createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z" }], sourceSummary: [], failureSummary: [],
  } }));
  await page.route("**/api/jobs/dense-job/events?**", (route) => route.fulfill(fail
    ? { status: 500, json: { error: "Controlled event service failure" } }
    : { json: { events: new URL(route.request().url()).searchParams.has("beforeId") ? makeEvents(100, 1) : makeEvents(0, 100) } }));
  for (const [theme, locale] of [["light", "en"], ["dark", "zh"]] as const) {
    await context.addCookies([
      { name: "vps-theme", value: theme, url: baseURL! }, { name: "vps-locale", value: locale, url: baseURL! },
    ]);
    await page.goto("/operation-tasks?status=completed");
    const opener = page.getByRole("button", { name: /(?:查看事件流|View event stream).*101/ });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: /任务事件流|Job event stream/ });
    await expect(dialog.locator("li")).toHaveCount(100);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await fitsViewport(dialog);
      await fitsViewport(dialog.getByRole("button", { name: /关闭|Close/ }));
      await fitsViewport(dialog.getByRole("button", { name: /加载更早|Load earlier/ }));
      expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`events-${theme}-${viewport.width}x${viewport.height}.png`) });
      if (viewport.width === 320) await accessibleDialog(page);
    }
    await dialog.getByRole("button", { name: /加载更早|Load earlier/ }).click();
    await expect(dialog.locator("li")).toHaveCount(101);
    await expect(dialog.getByRole("button", { name: /加载更早|Load earlier/ })).toBeHidden();
    fail = true;
    await dialog.getByRole("button", { name: /刷新|Refresh/ }).click();
    await expect(dialog.getByRole("alert")).toContainText("Controlled event service failure");
    fail = false;
    await dialog.getByRole("button", { name: /刷新|Refresh/ }).click();
    await expect(dialog.getByRole("alert")).toBeHidden();
    await expect(dialog.locator("li")).toHaveCount(100);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  }
  expect(errors).toEqual([]);
});
