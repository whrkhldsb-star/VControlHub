// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { countGunzipOutput } from "../gunzip-limiter";

describe("countGunzipOutput", () => {
	let dir: string;
	beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "vch-gz-count-")); });
	afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

	it("counts every member of a concatenated file, not the last one's trailer", async () => {
		// Two logs joined with cat: 24 + 25 bytes. The trailer says 25, and
		// the extraction refused the file as too large.
		const file = path.join(dir, "joined.log.gz");
		await writeFile(file, Buffer.concat([gzipSync("first log line, 24 bytes"), gzipSync("second log line, 25 bytes")]));
		await expect(countGunzipOutput(file, 1024, "too large")).resolves.toBe(49);
	});

	it("stops at the cap without writing anything", async () => {
		const file = path.join(dir, "bomb.gz");
		await writeFile(file, gzipSync(Buffer.alloc(64 * 1024)));
		await expect(countGunzipOutput(file, 1024, "too large")).rejects.toMatchObject({ status: 413, message: "too large" });
	});
});
