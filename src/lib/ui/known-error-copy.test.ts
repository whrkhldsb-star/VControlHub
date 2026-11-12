import { describe, expect, it } from "vitest";

import { collapseAbsolutePaths, describeKnownError } from "./known-error-copy";

const t = (key: string) => key;

describe("describeKnownError", () => {
	it("maps ENOENT to the path-missing summary and keeps the raw detail", () => {
		const copy = describeKnownError("ENOENT: no such file or directory, scandir 'data'", t);
		expect(copy.summary).toBe("commonError.pathMissing");
		expect(copy.detail).toContain("ENOENT");
	});

	it("collapses absolute host paths in the detail so the directory layout is not exposed", () => {
		const copy = describeKnownError(
			"Scanning /srv/vcontrolhub/storage/teams/abc failed: ENOENT: no such file or directory, scandir '/srv/vcontrolhub/storage/teams/abc'",
			t,
		);
		expect(copy.detail).not.toContain("/srv/vcontrolhub");
		expect(copy.detail).toContain("…/abc");
		expect(copy.detail).toContain("ENOENT");
	});
});

describe("describeKnownError without a rule", () => {
	it("leaves a sentence as the message instead of putting 'an unexpected error occurred' above it", () => {
		// The drive showed "操作未能完成：发生意外错误。" over "未登录或会话已过期" and over "无法连接到服务器，请检查网络后重试".
		for (const sentence of ["未登录或会话已过期", "无法连接到服务器，请检查网络后重试", "没有此存储节点或路径的访问授权"]) {
			expect(describeKnownError(sentence, t)).toEqual({ summary: null, detail: sentence });
		}
		// A raw message nothing is known about is shown too, with the host's directories still collapsed.
		expect(describeKnownError("Scanning /srv/vcontrolhub/storage/x failed: EIO: i/o error", t)).toEqual({ summary: null, detail: "Scanning …/x failed: EIO: i/o error" });
	});

	it("says something when there is nothing to show", () => {
		expect(describeKnownError("  ", t)).toEqual({ summary: "commonError.generic", detail: "" });
	});
});

describe("collapseAbsolutePaths", () => {
	it("leaves relative paths, URLs and bare words alone", () => {
		expect(collapseAbsolutePaths("open backups/x.tar.gz failed")).toBe("open backups/x.tar.gz failed");
		expect(collapseAbsolutePaths("GET https://example.com/a/b 502")).toBe("GET https://example.com/a/b 502");
		expect(collapseAbsolutePaths("/ is read-only")).toBe("/ is read-only");
	});
});

describe("describeKnownError codes before operations", () => {
	it("calls a folder that cannot be read a permission problem, not a missing path", () => {
		// "scandir" is in both; the pathMissing rule matched it first.
		const t = (key: string) => key;
		expect(describeKnownError("EACCES: permission denied, scandir '/srv/data/private'", t).summary).toBe("commonError.accessDenied");
		expect(describeKnownError("ENOENT: no such file or directory, scandir '/srv/data/gone'", t).summary).toBe("commonError.pathMissing");
	});
});
