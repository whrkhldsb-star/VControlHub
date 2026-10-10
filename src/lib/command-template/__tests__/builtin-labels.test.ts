import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { en, zh } from "@/lib/i18n/dictionaries/templates-page";
import { builtinTemplateKey, localizeBuiltinTemplate } from "../builtin-labels";
import { BUILTIN_TEMPLATES } from "../service";

const translate = (dict: Record<string, string>) => (key: string) => dict[key] ?? key;

describe("built-in command template labels", () => {
	it("names every built-in template in both languages", () => {
		for (const template of BUILTIN_TEMPLATES) {
			const base = `builtinTemplate.${builtinTemplateKey(template.name)}`;
			for (const dict of [zh, en]) {
				expect(dict[`${base}.name`], template.name).toBeTruthy();
				expect(dict[`${base}.description`], template.name).toBeTruthy();
			}
		}
	});

	it("translates built-ins and leaves a team's own templates as written", () => {
		expect(localizeBuiltinTemplate({ name: "Check Port Listening", description: "x", isBuiltin: true }, translate(zh)))
			.toMatchObject({ name: "检查端口监听", description: "检查指定端口是否在监听" });
		const own = { name: "Check Port Listening", description: "mine", isBuiltin: false };
		expect(localizeBuiltinTemplate(own, translate(zh))).toBe(own);
	});
});
