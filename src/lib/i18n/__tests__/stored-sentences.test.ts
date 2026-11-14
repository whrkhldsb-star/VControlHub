// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { localizeStoredSentence, localizeStoredText } from "../stored-sentences";

/**
 * Background processes store what they did as text, in English literals or in the language of the moment.
 * A Chinese page showed "Stale PENDING job abandoned after 7d without claim" and an English page
 * "已派发命令请求 …，等待最终结果". The page now says them in its own language; the data is unchanged.
 */
describe("stored sentences", () => {
	it("says the platform's English literals in either language", () => {
		expect(localizeStoredSentence("Stale PENDING job abandoned after 7d without claim", "zh")).toBe("等待 7 天仍没有执行器领取，已取消");
		expect(localizeStoredSentence("Completed command request cmd_1", "zh")).toBe("命令请求 cmd_1 已完成");
		expect(localizeStoredSentence("Execution failed: command request cmd_1 ended as REJECTED", "zh")).toBe("执行失败：命令请求 cmd_1 的结果是“已拒绝”");
		expect(localizeStoredSentence("Execution failed: command request cmd_1 ended as REJECTED", "en")).toBe("Execution failed: command request cmd_1 ended as “rejected”");
		expect(localizeStoredSentence("Running DATABASE backup", "zh")).toBe("正在执行数据库备份");
		expect(localizeStoredSentence("Scanning nas-1 (2/5)", "zh")).toBe("正在扫描 nas-1（2/5）");
		expect(localizeStoredSentence("Installing jellyfin on default: pulling image and creating container", "zh")).toBe("正在 default 上安装 jellyfin：拉取镜像并创建容器");
		expect(localizeStoredSentence("Preparing to execute QuickService uninstall: jellyfin", "en")).toBe("Preparing to uninstall quick service jellyfin");
	});

	it("says a dictionary sentence stored in one language in the other", () => {
		expect(localizeStoredSentence("已派发命令请求 cmd_1，等待最终结果", "en")).toBe("Dispatched command request cmd_1; awaiting the final result");
		expect(localizeStoredSentence("Backend executor heartbeat expired, re-queued", "zh")).toBe("后台执行器心跳超时，任务已重新入队");
	});

	it("says the sentence inside a sentence too", () => {
		expect(localizeStoredSentence("已作废：Stale PENDING backup abandoned after 24h without worker claim", "en")).toBe("Voided: no worker picked it up within 24 hours");
		expect(localizeStoredSentence("已作废：Stale PENDING backup abandoned after 24h without worker claim", "zh")).toBe("已作废：等待 24 小时仍没有执行器领取");
		expect(localizeStoredSentence("已跳过：创建者已无执行权限（command requester lacks command:execute permission）", "en"))
			.toBe("Skipped: the creator is no longer authorized to execute commands (the creator may not execute commands)");
		expect(localizeStoredSentence("Execution failed: Stale PENDING backup abandoned after timeout", "zh")).toBe("执行失败：等待超时仍没有执行器领取");
	});

	it("shows anything else as stored", () => {
		for (const text of ["rsync: connection refused", "SMTP failed", "50%", "执行失败：磁盘已满", "Execution timed out"]) {
			expect(localizeStoredSentence(text, "zh")).toBe(text);
			expect(localizeStoredSentence(text, "en")).toBe(text);
		}
		expect(localizeStoredSentence("Execution failed: disk full", "zh")).toBe("执行失败：disk full");
		expect(localizeStoredText(null, "zh")).toBeNull();
		expect(localizeStoredText("", "zh")).toBe("");
	});
});

const LIB = join(process.cwd(), "src", "lib");

function sources(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry === "__tests__" || entry === "dictionaries") continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) sources(path, out);
		else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(path);
	}
	return out;
}

/** A new job progress written as a plain English literal must be added to the stored forms. */
describe("job progress the workers write", () => {
	const literals = sources(LIB).flatMap((file) =>
		[...readFileSync(file, "utf8").matchAll(/\bprogress: "([^"]*[A-Za-z][^"]*)"/g)].map((match) => ({ file: relative(process.cwd(), file), text: match[1]! })),
	);

	it("is found where the test expects it", () => {
		expect(literals.length).toBeGreaterThan(20);
	});

	it("is said in the reader's language", () => {
		const unknown = literals.filter(({ text }) => localizeStoredSentence(text, "zh") === text).map(({ file, text }) => `${file}: ${text}`);
		expect(unknown).toEqual([]);
	});
});
