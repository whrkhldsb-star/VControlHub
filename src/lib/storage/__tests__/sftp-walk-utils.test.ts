import { describe, expect, it, vi } from "vitest";

/**
 * Tests for the shared SFTP walk helpers.
 *
 * These three functions look like trivial string work, but both of their callers
 * — `sftp-sync.ts` and `sftp-stale-inventory.ts` — use the result to decide
 * which index rows are *absent from the remote host* and therefore safe to
 * prune. Two properties matter:
 *
 * 1. A path outside the tree must return `null`, never a plausible-looking
 *    relative path. The prefix comparison has to be `base + "/"`, not a bare
 *    `startsWith(base)`, or `/root/drive-old` would be treated as living inside
 *    `/root/drive` and its entries would land in the "expected" set of the wrong
 *    node — the two callers coalesce `null` differently (`?? ""` in the
 *    inventory scanner, early-return in sync), so the distinction between "the
 *    base itself" (`""`) and "outside the tree" (`null`) is load-bearing.
 * 2. Trailing slashes must not change the answer, because the base path comes
 *    from operator-entered node config and the directory path is assembled
 *    during the walk.
 *
 * `withDirectoryTimeout` must also clear its timer on the happy path: the walk
 * calls it once per directory, so a leaked timer per call would keep the worker
 * process awake for the full timeout after a scan finished.
 */
import {
	computeDirectoryRelativePath,
	computeRelativePath,
	withDirectoryTimeout,
} from "../sftp-walk-utils";

describe("computeRelativePath", () => {
	it("returns the bare entry name for an entry directly in the base", () => {
		expect(computeRelativePath("/root/drive", "/root/drive", "a.txt")).toBe("a.txt");
	});

	it("joins the subdirectory path for a nested entry", () => {
		expect(computeRelativePath("/root/drive", "/root/drive/docs", "a.txt")).toBe("docs/a.txt");
		expect(computeRelativePath("/root/drive", "/root/drive/docs/2026", "a.txt")).toBe("docs/2026/a.txt");
	});

	it("ignores trailing slashes on either path", () => {
		expect(computeRelativePath("/root/drive/", "/root/drive", "a.txt")).toBe("a.txt");
		expect(computeRelativePath("/root/drive", "/root/drive/docs/", "a.txt")).toBe("docs/a.txt");
		expect(computeRelativePath("/root/drive///", "/root/drive/docs///", "a.txt")).toBe("docs/a.txt");
	});

	it("handles a root base path without producing a leading slash", () => {
		expect(computeRelativePath("/", "/", "a.txt")).toBe("a.txt");
		expect(computeRelativePath("/", "/sub", "a.txt")).toBe("sub/a.txt");
	});

	it("returns null for a sibling directory that merely shares the base's prefix", () => {
		// The bug this guards: `startsWith("/root/drive")` without the separator
		// would accept "/root/drive-old" and file its entries under this node.
		expect(computeRelativePath("/root/drive", "/root/drive-old", "a.txt")).toBeNull();
		expect(computeRelativePath("/root/drive", "/root/drivex/docs", "a.txt")).toBeNull();
	});

	it("returns null for a path above or beside the base", () => {
		expect(computeRelativePath("/root/drive", "/root", "a.txt")).toBeNull();
		expect(computeRelativePath("/root/drive", "/etc", "passwd")).toBeNull();
		expect(computeRelativePath("/root/drive", "", "a.txt")).toBeNull();
	});

	it("keeps unicode and spaces in entry names intact", () => {
		expect(computeRelativePath("/root/drive", "/root/drive/报告", "年度 总结.txt")).toBe("报告/年度 总结.txt");
	});
});

describe("computeDirectoryRelativePath", () => {
	it("returns an empty string for the base directory itself", () => {
		// "" and null mean different things to the callers: "" is "the whole node"
		// (no relativePath prefix filter), null is "not in this tree at all".
		expect(computeDirectoryRelativePath("/root/drive", "/root/drive")).toBe("");
		expect(computeDirectoryRelativePath("/root/drive/", "/root/drive")).toBe("");
		expect(computeDirectoryRelativePath("/", "/")).toBe("");
	});

	it("returns the relative directory path for a descendant", () => {
		expect(computeDirectoryRelativePath("/root/drive", "/root/drive/docs")).toBe("docs");
		expect(computeDirectoryRelativePath("/root/drive", "/root/drive/docs/2026/")).toBe("docs/2026");
		expect(computeDirectoryRelativePath("/", "/sub/dir")).toBe("sub/dir");
	});

	it("returns null rather than an empty string for a path outside the tree", () => {
		// Distinguishing these is what stops a prune pass from treating a foreign
		// directory as "the whole node" and diffing every row against it.
		expect(computeDirectoryRelativePath("/root/drive", "/root/drive-old")).toBeNull();
		expect(computeDirectoryRelativePath("/root/drive", "/root")).toBeNull();
		expect(computeDirectoryRelativePath("/root/drive", "/var/lib")).toBeNull();
	});

	it("agrees with computeRelativePath about what is inside the tree", () => {
		const cases: Array<[string, string]> = [
			["/root/drive", "/root/drive"],
			["/root/drive", "/root/drive/docs"],
			["/root/drive", "/root/drive-old"],
			["/root/drive", "/etc"],
			["/", "/sub"],
		];
		for (const [base, dir] of cases) {
			const dirResult = computeDirectoryRelativePath(base, dir);
			const entryResult = computeRelativePath(base, dir, "x");
			// Either both accept the directory or both reject it — sync uses the
			// directory form to build the prune prefix and the entry form to build
			// the expected set, so a disagreement would prune live files.
			expect(dirResult === null).toBe(entryResult === null);
		}
	});
});

describe("withDirectoryTimeout", () => {
	it("resolves with the operation's value when it settles in time", async () => {
		await expect(withDirectoryTimeout(Promise.resolve(["a"]), "/root/drive", 1_000)).resolves.toEqual(["a"]);
	});

	it("clears the timer on success so the process is not held awake", async () => {
		// One call per directory: a leaked timer would keep the worker alive for
		// the full timeout after every scan.
		const clearSpy = vi.spyOn(globalThis, "clearTimeout");
		try {
			await withDirectoryTimeout(Promise.resolve("ok"), "/root/drive", 5_000);
			expect(clearSpy).toHaveBeenCalled();
		} finally {
			clearSpy.mockRestore();
		}
	});

	it("rejects with a message naming the directory and the timeout in seconds", async () => {
		vi.useFakeTimers();
		try {
			const pending = withDirectoryTimeout(new Promise(() => {}), "/root/drive/docs", 2_500);
			const assertion = expect(pending).rejects.toThrow(/\/root\/drive\/docs exceeded 3 seconds/);
			await vi.advanceTimersByTimeAsync(2_500);
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});

	it("uses the caller's stoppedVerb so sync and prune read differently in the log", async () => {
		vi.useFakeTimers();
		try {
			const pending = withDirectoryTimeout(new Promise(() => {}), "/d", 1_000, { stoppedVerb: "syncing" });
			const assertion = expect(pending).rejects.toThrow(/stopped syncing this directory/);
			await vi.advanceTimersByTimeAsync(1_000);
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});

	it("propagates the operation's own rejection rather than masking it as a timeout", async () => {
		await expect(
			withDirectoryTimeout(Promise.reject(new Error("permission denied")), "/root/drive", 1_000),
		).rejects.toThrow("permission denied");
	});
});
