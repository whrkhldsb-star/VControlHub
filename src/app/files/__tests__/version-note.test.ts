import { describe, expect, it } from "vitest";

import { browserT } from "@/lib/i18n/browser-translations";

import { versionNoteLabel } from "../version-note";

/**
 * The version list showed "Before restore to v3" and "Before single-shot upload overwrite" on a Chinese
 * page: the server writes these notes itself and stores them in English.
 */
describe("versionNoteLabel", () => {
	const zh = (key: string, vars?: Record<string, string | number>) => browserT(key, "zh", vars);
	const en = (key: string, vars?: Record<string, string | number>) => browserT(key, "en", vars);

	it("says the system's notes in the page's language", () => {
		expect(versionNoteLabel("Before restore to v3", zh)).toBe("恢复到 v3 之前的内容");
		expect(versionNoteLabel("Before text editor save", zh)).toBe("在线编辑保存之前的内容");
		expect(versionNoteLabel("Before single-shot upload overwrite", zh)).toBe("上传覆盖之前的内容");
		expect(versionNoteLabel("Before resumable upload overwrite", zh)).toBe("上传覆盖之前的内容");
		expect(versionNoteLabel("Before restore to v12", en)).toBe("Content before the restore to v12");
	});

	it("leaves a note that a person typed as it is", () => {
		expect(versionNoteLabel("发布前备份", zh)).toBe("发布前备份");
		expect(versionNoteLabel("Before restore to v3 (kept by hand)", zh)).toBe("Before restore to v3 (kept by hand)");
	});
});
