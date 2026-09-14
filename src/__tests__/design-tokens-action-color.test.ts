import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";

const css = postcss.parse(readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8"));
const tokens = postcss.parse(readFileSync(join(process.cwd(), "src/app/styles/tokens.css"), "utf8"));

function palette(theme: "dark" | "light") {
  const values = new Map<string, string>();
  tokens.walkRules((rule) => {
    if (rule.selector === ":root" || (theme === "light" && rule.selector === "html.light")) {
      rule.walkDecls((declaration) => { values.set(declaration.prop, declaration.value); });
    }
  });
  const resolve = (name: string): string => {
    const value = values.get(name);
    if (!value) throw new Error(`Missing theme token: ${name}`);
    return value.startsWith("var(") ? resolve(value.slice(4, -1)) : value;
  };
  return resolve;
}

function luminance(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Expected opaque color: ${hex}`);
  const channels = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

describe("Shared theme contracts", () => {
  it.each(["dark", "light"] as const)("keeps text and command colors readable in %s mode", (theme) => {
    const color = palette(theme);
    const pairs = [
      ["--text-primary", "--surface"], ["--text-secondary", "--surface"], ["--text-muted", "--background"],
      ["--color-action-fg", "--color-action"], ["--color-action-fg", "--color-action-hover"],
      ["--solid-action-fg", "--color-danger-action"], ["--solid-action-fg", "--color-success-action"],
      ["--success", "--success-bg"], ["--danger", "--danger-bg"], ["--warning", "--warning-bg"],
    ];
    for (const [foreground, background] of pairs) {
      const a = luminance(color(foreground!));
      const b = luminance(color(background!));
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `${theme}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(color("--accent")).not.toBe(color("--color-action"));
  });

  it("defines every public action variant in the component layer", () => {
    const selectors = new Set<string>();
    css.walkRules((rule) => { for (const selector of rule.selectors) selectors.add(selector); });
    expect(selectors.has("[data-action-button]")).toBe(true);
    for (const variant of ["primary", "outline", "ghost", "success", "danger", "warning", "secondary", "danger-solid", "success-solid"]) {
      expect(selectors.has(`[data-action-button][data-variant="${variant}"]`)).toBe(true);
    }
  });

  it("keeps primary actions connected to the semantic foreground and background", () => {
    let primary = "";
    css.walkRules((rule) => {
      if (rule.selectors.includes('[data-action-button][data-variant="primary"]')) primary = rule.toString();
    });
    expect(primary).toContain("var(--color-action)");
    expect(primary).toContain("var(--color-action-fg)");
  });
});
