// @vitest-environment node
import { describe, expect, it } from "vitest";

import { APP_TIME_ZONE } from "@/lib/datetime/time-zone";
import { en as apiCopyEn, zh as apiCopyZh } from "@/lib/i18n/dictionaries/api-copy";
import { browserTranslations } from "@/lib/i18n/browser-translations";
import { serviceTranslations } from "@/lib/i18n/service-translations";
import { interpolate } from "@/lib/i18n/core";

/** Every sentence the product can show, by language. */
const all = {
	zh: { ...serviceTranslations.zh, ...browserTranslations.zh, ...(apiCopyZh as Record<string, string>) },
	en: { ...serviceTranslations.en, ...browserTranslations.en, ...(apiCopyEn as Record<string, string>) },
};

describe("what the dictionaries say", () => {
	it("is the application, not an empty set", () => {
		expect(Object.keys(all.zh).length).toBeGreaterThan(5000);
		expect(Object.keys(all.en).length).toBe(Object.keys(all.zh).length);
	});

	// Schedules, daily buckets and silence windows run in APP_TIME_ZONE, which an installation can set. Four
	// sentences named Asia/Shanghai ("Beijing time") whatever it was set to.
	it("names the platform's time zone through {zone}, never a fixed one", () => {
		const fixed = Object.entries({ ...all.zh, ...Object.fromEntries(Object.entries(all.en).map(([key, value]) => [`${key} (en)`, value])) })
			.filter(([, value]) => /Asia\/Shanghai|北京时间|Beijing time/i.test(value))
			.map(([key]) => key);
		expect(fixed).toEqual([]);
	});

	it.each([
		"playbooksPage.createForm.cronHint",
		"playbooksPage.schedule.nextRun",
		"alertRulesPage.createForm.silenceWindowsHint",
		"settingsClient.field.offsite.dailyWindowHour.helper",
	])("%s takes the zone it is given", (key) => {
		for (const locale of ["zh", "en"] as const) {
			expect(all[locale][key]).toContain("{zone}");
			expect(interpolate(all[locale][key]!, { zone: "Europe/Berlin", time: "09:00" })).toContain("Europe/Berlin");
		}
		expect(APP_TIME_ZONE).toBeTruthy();
	});

	it("uses the same placeholders in both languages", () => {
		const names = (value: string) => [...new Set([...value.matchAll(/(?<!\{)\{([A-Za-z0-9_]+)\}(?!\})/g)].map((match) => match[1]))].sort().join(",");
		const different = Object.keys(all.zh).filter((key) => all.en[key] !== undefined && names(all.zh[key]!) !== names(all.en[key]!));
		expect(different).toEqual([]);
	});

	// "上次触发:{date}", "冷却时间(分钟)", "执行: {name}...": half-width marks after Chinese text sit too close
	// to it and read as a different hand from the sentences around them.
	it("punctuates Chinese with Chinese marks", () => {
		const allowed = new Set([
			// Stored in a message and recognised later by its exact text (EMPTY_TOOL_CONTENT).
			"aiPage.noResponse",
			"apiAiChat.emptyContent",
			// Examples of what is typed: tags are separated by a half-width comma.
			"snippetsPage.modal.field.tagsHint",
			"filePreferences.tagsPlaceholder",
		]);
		const halfWidth = Object.entries(all.zh)
			.filter(([key, value]) => !allowed.has(key) && (/[一-鿿][:,;!?](?:\s|$|\{)/.test(value) || /[一-鿿]\.(?:\s|$)/.test(value) || /\((?=[^)]*[一-鿿])/.test(value)))
			.map(([key, value]) => `${key}: ${value}`);
		expect(halfWidth).toEqual([]);
	});

	// A sentence put together from "共", a number and "台纳管节点" keeps one language's word order and
	// punctuation in the code. What is shown is one entry with placeholders; an entry that starts or ends
	// with a space is a piece of such a sentence.
	it("holds whole sentences, not pieces to be joined", () => {
		const allowed = (key: string, value: string) =>
			// A label in front of a value ("Risk: "), and the separator of a list.
			/: $/.test(value) || /separator$/i.test(key) || key === "common.colon"
			// "（任务 id）" where there is a task: placed inside six sentences by {task}.
			|| key === "qsActions.taskSuffix";
		const pieces = (["zh", "en"] as const).flatMap((locale) =>
			Object.entries(all[locale])
				// Text that is appended to a file or a prompt starts or ends with a line break of its own.
				.filter(([key, value]) => /^\s|\s$/.test(value) && !/^\n|\n$/.test(value) && !allowed(key, value))
				.map(([key, value]) => `${locale} ${key}: "${value}"`),
		);
		expect(pieces).toEqual([]);
	});

	it("has no empty sentence and no Chinese left in the English ones", () => {
		expect(Object.entries(all.zh).filter(([, value]) => value === "").map(([key]) => key)).toEqual([]);
		expect(Object.entries(all.en).filter(([, value]) => value === "").map(([key]) => key)).toEqual([]);
		// The names of languages are written in their own language on purpose.
		const chinese = Object.entries(all.en).filter(([key, value]) => /[一-鿿]/.test(value) && !/language|locale|lang\b/i.test(key)).map(([key]) => key);
		expect(chinese).toEqual([]);
	});
});
