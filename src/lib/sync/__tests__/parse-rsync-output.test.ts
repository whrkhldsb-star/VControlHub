import { describe, expect, it } from "vitest";

import { parseRsyncOutput } from "../service-runtime";

// Verbatim tails of `rsync -av --stats` (rsync 3.2) copying 1,005 one-byte
// files, then running again with nothing changed.
const FIRST_RUN = "Number of files: 1,006 (reg: 1,005, dir: 1)\nNumber of created files: 1,005 (reg: 1,005)\nNumber of deleted files: 0\nNumber of regular files transferred: 1,005\nTotal file size: 1,005 bytes\nTotal transferred file size: 1,005 bytes\nLiteral data: 1,005 bytes\nMatched data: 0 bytes\nFile list size: 0\nFile list generation time: 0.004 seconds\nFile list transfer time: 0.000 seconds\nTotal bytes sent: 59,152\nTotal bytes received: 19,111\n\nsent 59,152 bytes  received 19,111 bytes  156,526.00 bytes/sec\ntotal size is 1,005  speedup is 0.01\n";
const NOTHING_CHANGED = "Number of files: 1,006 (reg: 1,005, dir: 1)\nNumber of created files: 0\nNumber of deleted files: 0\nNumber of regular files transferred: 0\nTotal file size: 1,005 bytes\nTotal transferred file size: 0 bytes\nLiteral data: 0 bytes\nMatched data: 0 bytes\nFile list size: 0\nFile list generation time: 0.002 seconds\nFile list transfer time: 0.000 seconds\nTotal bytes sent: 14,928\nTotal bytes received: 12\n\nsent 14,928 bytes  received 12 bytes  29,880.00 bytes/sec\ntotal size is 1,005  speedup is 0.07\n";

describe("parseRsyncOutput", () => {
	it("reads counts with thousands separators", () => {
		expect(parseRsyncOutput(FIRST_RUN)).toEqual({ totalFiles: 1006, transferredFiles: 1005, totalSize: 1005 });
	});

	it("reports a run that changed nothing as zero, not a guess from the output lines", () => {
		expect(parseRsyncOutput(NOTHING_CHANGED)).toEqual({ totalFiles: 1006, transferredFiles: 0, totalSize: 0 });
	});

	it("falls back to counting listed files only without a --stats block", () => {
		expect(parseRsyncOutput("a.txt\nb.txt\n").transferredFiles).toBe(2);
	});
});
