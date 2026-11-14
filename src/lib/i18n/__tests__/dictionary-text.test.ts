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
		// A mark between two Chinese words counts too: "暂无节点,默认匹配全部节点" and "08:00,可用换行" were not caught
		// while the rule only looked at what followed a mark.
		const halfWidth = Object.entries(all.zh)
			// Parentheses beside Chinese text are full-width too ("工单 ({count})" → "工单（{count}）"); "http(s)"
			// is a term, not a remark in parentheses.
			.filter(([key, value]) => !allowed.has(key) && (/[一-鿿][:,;!?]/.test(value) || /[:,;!?][一-鿿]/.test(value) || /[一-鿿]\.(?:\s|$)/.test(value) || /\((?=[^)]*[一-鿿])/.test(value) || /[一-鿿]\s?\(|\)\s?[一-鿿]/.test(value.replaceAll("http(s)", ""))))
			.map(([key, value]) => `${key}: ${value}`);
		expect(halfWidth).toEqual([]);
	});

	// "加载中..." beside "搜索页面、服务器或操作…": three full stops and the ellipsis character were used about
	// equally, in both languages. An ellipsis is one character; three stops stay only where they are part of
	// something typed (a path, a link, an example key) or of text added to a file.
	it("writes an ellipsis as one character", () => {
		const allowed = new Set([
			"downloadsPage.form.linkPlaceholder",
			"settingsClient.schema.section.platform.description",
			"settingsClient.field.offsite.accessKeyId.placeholder",
			"aiPage.fileTruncatedSuffix",
		]);
		const stops = (["zh", "en"] as const).flatMap((locale) =>
			Object.entries(all[locale])
				.filter(([key, value]) => !allowed.has(key) && value.includes("..."))
				.map(([key, value]) => `${locale} ${key}: ${value}`),
		);
		expect(stops).toEqual([]);
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
				// Text that is appended to a file or a prompt starts or ends with a line break of its own. An entry
				// that starts with a joining mark ("，清理 {removed} 条失效索引") is the tail of another sentence.
				.filter(([key, value]) => ((/^\s|\s$/.test(value) && !/^\n|\n$/.test(value)) || /^[，、；,;]/.test(value)) && !allowed(key, value))
				.map(([key, value]) => `${locale} ${key}: "${value}"`),
		);
		expect(pieces).toEqual([]);
	});

	// "1 items", "1 days ago", "1 nodes enabled": an English count takes its noun's form from the number,
	// "{count} {count|item|items}" (interpolate). Limits ("at most {max} files") are never 1.
	it("gives an English count the noun form for its number", () => {
		const nouns = "items|files|nodes|servers|records|entries|endpoints|administrators|recipients|chats|accounts|links|models|rules|directories|days|times|changes|minutes|hours|targets|notifications|images|containers|groups|uploads|results|checks|warnings|settings|chunks|failures|events|runs|steps|keys|ports|tabs|cores|processes|lines|samples|things|downloads|permissions|docs";
		const bare = new RegExp(`\\{(\\w+)\\}((?: [a-zA-Z-]+){0,3}? )(${nouns})\\b`);
		const limits = new Set(["apiCopy.archive.tooManyEntries", "api.share.tooManyFiles", "backend.webdav.directoryTooLarge", "backend.sftp.directoryListingTruncated", "sharePage.listTruncated", "sharesPage.button.tooMany"]);
		const offenders = Object.entries(all.en)
			.filter(([key, value]) => {
				// A plural form never matches: its noun follows "|", not a space.
				const match = bare.exec(value);
				return match !== null && !limits.has(key) && !/^(?:max|min|limit)$/.test(match[1] ?? "");
			})
			.map(([key, value]) => `${key}: ${value}`);
		expect(offenders).toEqual([]);
	});

	// English labels were half "New Playbook", "Add Step", "Alert Rules" and half "Refresh forecast", "Add tag".
	// They are sentence case; names keep their capitals (the built-in templates, the catalog's apps, products,
	// providers, acronyms).
	it("writes English labels in sentence case", () => {
		const small = new Set(["a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "by", "with", "at", "per", "vs", "via", "as", "from", "into", "is"]);
		const acronym = /^[A-Z0-9][A-Z0-9/&.+-]*s?$/;
		const names = /\b(?:Docker(?: Compose)?|Nginx|Telegram|Cloudflare|Turnstile|Komari|Linux|Windows|macOS|MySQL|PostgreSQL|Redis|GitHub|Git|Caddy|WebSocket|WebDAV|Markdown|Chinese|English|Tencent Cloud|Agent|Direct Gateway|VControlHub|Bot Token|Webhook)\b/g;
		const isName = (key: string) => /^(?:builtinTemplate|qsCatalog|openapiSpec|apiCopy)\.|^costPage\.billing\.provider\.|^languageToggle\.switchLabel$|^itsmPage\.field\.webhookSecretPlaceholder$|^backend\./.test(key);
		const offenders = Object.entries(all.en)
			.filter(([key, value]) => {
				if (isName(key) || value.includes("{") || value.length > 60 || /[.?!:]$/.test(value)) return false;
				const words = value.replace(names, "").match(/[A-Za-z][A-Za-z0-9'’-]*/g) ?? [];
				const content = words.slice(1).filter((word) => !small.has(word.toLowerCase()) && !acronym.test(word));
				return content.length > 0 && content.every((word) => /^[A-Z]/.test(word)) && words.length >= 2;
			})
			.map(([key, value]) => `${key}: ${value}`);
		expect(offenders).toEqual([]);
	});

	it("has no empty sentence and no Chinese left in the English ones", () => {
		expect(Object.entries(all.zh).filter(([, value]) => value === "").map(([key]) => key)).toEqual([]);
		expect(Object.entries(all.en).filter(([, value]) => value === "").map(([key]) => key)).toEqual([]);
		// The names of languages are written in their own language on purpose.
		const chinese = Object.entries(all.en).filter(([key, value]) => /[一-鿿]/.test(value) && !/language|locale|lang\b/i.test(key)).map(([key]) => key);
		expect(chinese).toEqual([]);
	});
});
