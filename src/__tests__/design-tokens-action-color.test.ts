import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";

import { TAG_FILL_PERCENT, TAG_TEXT_HUE_PERCENT } from "@/app/status/board-visuals";

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
      // The rest of what the header of tokens.css promises: badges of the other hues, links and command text,
      // and muted text on each surface it is written on.
      ["--info", "--info-bg"], ["--indigo", "--indigo-bg"], ["--purple", "--purple-bg"],
      ["--accent", "--accent-bg"], ["--accent", "--surface"], ["--color-action-text", "--color-action-bg"], ["--color-action-text", "--surface"],
      ["--text-muted", "--surface"], ["--text-muted", "--surface-elevated"], ["--text-muted", "--surface-hover"], ["--text-muted", "--modal-bg"],
      ["--text-muted", "--sidebar-bg"], ["--sidebar-active-fg", "--sidebar-active"], ["--selection-fg", "--selection-bg"],
      ["--success", "--surface"], ["--warning", "--surface"], ["--danger", "--surface"], ["--info", "--surface"],
    ];
    for (const [foreground, background] of pairs) {
      const a = luminance(color(foreground!));
      const b = luminance(color(background!));
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `${theme}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(color("--accent")).not.toBe(color("--color-action"));
  });

  it.each(["dark", "light"] as const)("keeps the coloured tags of the status board readable in %s mode", (theme) => {
    // A tag is written in its own hue on a tint of that hue. In the light theme five of the six hues were
    // below 4.5:1 as text (amber 2.7:1, green 3.2:1), at 11px, on a page shown to anonymous visitors.
    const color = palette(theme);
    const mix = (a: string, b: string, share: number) =>
      `#${[1, 3, 5].map((start) => Math.round(parseInt(a.slice(start, start + 2), 16) * share + parseInt(b.slice(start, start + 2), 16) * (1 - share)).toString(16).padStart(2, "0")).join("")}`;
    for (let index = 1; index <= 6; index += 1) {
      const hue = color(`--chart-${index}`);
      const text = luminance(mix(hue, color("--text-primary"), TAG_TEXT_HUE_PERCENT / 100));
      const fill = luminance(mix(hue, color("--surface"), TAG_FILL_PERCENT / 100));
      expect((Math.max(text, fill) + 0.05) / (Math.min(text, fill) + 0.05), `${theme}: tag in --chart-${index}`).toBeGreaterThanOrEqual(4.5);
    }
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
