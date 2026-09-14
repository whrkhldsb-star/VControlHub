import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const output = path.resolve(process.argv[2] ?? "/tmp/vcontrolhub-ui-showcase");
const browser = await chromium.launch({ headless: true });
let checks = 0;
try {
  for (const width of [320, 768, 1440]) for (const theme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(output, "index.html")).href);
    await page.getByRole("combobox", { name: "Theme" }).selectOption(theme);
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    for (const state of ["controls", "dialog", "states"]) {
      if (state === "dialog") await page.getByRole("button", { name: "Create node" }).click();
      if (state === "states") {
        await page.keyboard.press("Escape");
        await page.getByRole("tab", { name: "States" }).click();
      }
      const result = await page.evaluate(async () => {
        const offenders = [...document.querySelectorAll("body *")]
          .map((el) => ({ el, right: el.getBoundingClientRect().right }))
          .filter(({ right }) => right > innerWidth + 1)
          .slice(0, 8)
          .map(({ el }) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ").slice(0, 4).join(".")}`);
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          violations: (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map((item) => item.id),
          offenders,
        };
      });
      assert.ok(result.overflow <= 1, `${theme}/${width}/${state}: overflow ${result.overflow}; offenders: ${result.offenders.join(" | ")}`);
      assert.deepEqual(result.violations, [], `${theme}/${width}/${state}: accessibility ${JSON.stringify(result.violations)}`);
      await page.screenshot({ path: path.join(output, `${theme}-${width}-${state}.png`), fullPage: true });
      checks++;
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`${checks} component states passed: responsive layout, accessibility and runtime errors`);
} finally { await browser.close(); }
