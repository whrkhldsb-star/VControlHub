// @vitest-environment node
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listRelayFiles } from "../execution";
import { parseTransferManifest } from "../transfer-manifest";

/**
 * A multi-file torrent finishes as a folder of files. The relay read only
 * the top level, failed on the folder ("non-file entry") after the whole
 * download, and deleted it.
 */
describe("relay output folders", () => {
	let root = "";
	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), "vch-relay-"));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("lists the files inside a downloaded folder, without aria2's control files", async () => {
		await mkdir(path.join(root, "bundle", "extras"), { recursive: true });
		await writeFile(path.join(root, "bundle", "a.txt"), "a");
		await writeFile(path.join(root, "bundle", "extras", "b.txt"), "b");
		await writeFile(path.join(root, "bundle.aria2"), "control");
		await writeFile(path.join(root, "bundle", ".hidden"), "x");
		expect(await listRelayFiles(root)).toEqual(["bundle/a.txt", "bundle/extras/b.txt"]);
	});

	it.skipIf(process.platform === "win32")("still refuses a link", async () => {
		await writeFile(path.join(root, "real.txt"), "r");
		await symlink(path.join(root, "real.txt"), path.join(root, "link.txt"));
		await expect(listRelayFiles(root)).rejects.toThrow(/non-file/);
	});

	it("journals nested paths but never a step outside the folder", () => {
		const sha256 = "a".repeat(64);
		expect(parseTransferManifest({ version: 1, files: [{ name: "bundle/extras/b.txt", size: 1, sha256 }] })?.files[0]?.name).toBe("bundle/extras/b.txt");
		for (const name of ["../escape.txt", "bundle/../../x", "/abs.txt", "bundle//x", "a\\\\b"]) {
			expect(() => parseTransferManifest({ version: 1, files: [{ name, size: 1, sha256 }] })).toThrow();
		}
	});
});
