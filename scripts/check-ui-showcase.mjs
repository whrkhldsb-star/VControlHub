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
        const describe = (node) => {
          const el = node.element instanceof Element ? node.element : document.querySelector(node.target?.[0] ?? "*");
          if (!el) return String(node.target);
          const style = getComputedStyle(el);
          const label = (el.textContent || "").trim().slice(0, 40);
          return `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ").slice(0, 3).join(".")} "${label}" color=${style.color} bg=${style.backgroundColor}`;
        };
        const axe = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          violations: axe.violations.map((item) => item.id),
          // Per-node detail so a CI-only a11y failure names the element and
          // its computed colors instead of just the rule id.
          violationNodes: axe.violations.flatMap((item) =>
            item.nodes.slice(0, 5).map((node) => `${item.id}: ${describe(node)}`)),
          offenders,
        };
      });
      if (result.overflow > 1) console.log(`::error title=overflow::${theme}/${width}/${state}: overflow ${result.overflow}px; offenders: ${result.offenders.join(" | ")}`);
      assert.ok(result.overflow <= 1, `${theme}/${width}/${state}: overflow ${result.overflow}; offenders: ${result.offenders.join(" | ")}`);
      for (const v of result.violations) console.log(`::error title=a11y::${theme}/${width}/${state} axe violation: ${v}`);
      for (const n of result.violationNodes) console.log(`::error title=a11y-node::${theme}/${width}/${state} ${n}`);
      if (result.violations.length > 0) console.log(`::error title=a11y::${theme}/${width}/${state}: ${JSON.stringify(result.violations)}`);
      assert.deepEqual(result.violations, [], `${theme}/${width}/${state}: accessibility ${JSON.stringify(result.violations)}; nodes: ${result.violationNodes.join(" | ")}`);
      await page.screenshot({ path: path.join(output, `${theme}-${width}-${state}.png`), fullPage: true });
      checks++;
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`${checks} component states passed: responsive layout, accessibility and runtime errors`);
} finally { await browser.close(); }
