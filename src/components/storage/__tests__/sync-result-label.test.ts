import { describe, expect, it } from "vitest";

import { browserT } from "@/lib/i18n/browser-translations";
import { formatBidirectionalResult } from "@/lib/sync/bidirectional";

import { syncResultLabel } from "../sync-result-label";

/**
 * The sync panel printed the worker's stored line as it was: "Success: 12 files, 3.4 MB, 8s" and "Failed:
 * reclaimed stale RUNNING after 30m (worker may have died)" on a Chinese page.
 */
describe("syncResultLabel", () => {
	const zh = (key: string, vars?: Record<string, string | number>) => browserT(key, "zh", vars);
	const en = (key: string, vars?: Record<string, string | number>) => browserT(key, "en", vars);

	it("says a finished one-way run in the page's language", () => {
		expect(syncResultLabel("Success: 12 files, 3.4 MB, 8s", zh)).toBe("同步完成：12 个文件，3.4 MB，用时 8 秒");
		expect(syncResultLabel("Success: 12 files, 3.4 MB, 8s", en)).toBe("Sync finished: 12 files, 3.4 MB, 8 s");
	});

	it("reads the two-way line the worker writes", () => {
		const stats = (transferredFiles: number) => ({ transferredFiles, totalFiles: transferredFiles, totalSize: 0 });
		const stored = formatBidirectionalResult({ forward: stats(3), reverse: stats(2), durationMs: 4_000 });
		expect(syncResultLabel(stored, zh)).toBe("双向同步完成：正向 3 个文件，反向 2 个文件，共传输 5 个，用时 4 秒");
	});

	it("keeps what went through and why the way back failed", () => {
		const stored = "Partial: forward completed (7 files, 1.2 MB, 9s); reverse failed: rsync: connection unexpectedly closed. Bidirectional sync is not transactional.";
		expect(syncResultLabel(stored, zh)).toBe("部分完成：正向已同步 7 个文件（1.2 MB，9 秒），反向失败：rsync: connection unexpectedly closed。双向同步不会因为一个方向失败而撤回另一个方向。");
	});

	it("explains a run that was taken back, and shows any other failure with its reason as stored", () => {
		expect(syncResultLabel("Failed: reclaimed stale RUNNING after 30m (worker may have died)", zh)).toBe("失败：运行超过 30 分钟没有结束，已收回（执行它的进程可能已经退出）");
		expect(syncResultLabel("Failed: Permission denied (publickey)", zh)).toBe("失败：Permission denied (publickey)");
	});

	it("shows a line in no known shape as stored", () => {
		expect(syncResultLabel("Queued by an older version", zh)).toBe("Queued by an older version");
	});
});
