// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ExternalArchiveError, listExternalArchive, parse7zTechnicalListing, parseUnrarTechnicalListing } from "../archive-external-list";

/** `7z l -slt` of a solid archive, as 7-Zip 23.01 prints it (the packed size is blank after a block's first file). */
const SEVEN_ZIP_LISTING = `
7-Zip 23.01 (x64) : Copyright (c) 1999-2023 Igor Pavlov : 2023-06-20
 64-bit locale=C.UTF-8 Threads:2 OPEN_MAX:20000

Scanning the drive for archives:
1 file, 5317 bytes (6 KiB)

Listing archive: solid.7z

--
Path = solid.7z
Type = 7z
Physical Size = 5317
Headers Size = 240
Method = LZMA2:6k
Solid = +
Blocks = 1

----------
Path = docs
Size = 0
Packed Size = 0
Modified = 2026-11-11 10:41:55.2714158
Attributes = D drwxr-xr-x
CRC =
Encrypted = -
Method =
Block =

Path = docs/empty.txt
Size = 0
Packed Size = 0
Modified = 2026-11-11 10:41:55.2714158
Attributes = A -rw-r--r--
CRC =
Encrypted = -
Method =
Block =

Path = docs/a.txt
Size = 19
Packed Size = 5077
Modified = 2026-11-11 10:41:55.2679365
Attributes = A -rw-r--r--
CRC = 5762F31F
Encrypted = -
Method = LZMA2:6k
Block = 0

Path = docs/sub/报告 = 2024.txt
Size = 13
Packed Size =
Modified = 2026-11-11 10:41:55.2679365
Attributes = A -rw-r--r--
CRC = F430BD51
Encrypted = -
Method = LZMA2:6k
Block = 0
`;

/** `unrar lt` as unrar 7.00 prints it (the format since RAR 5, 2013). */
const UNRAR_LISTING = `
UNRAR 7.00 freeware      Copyright (c) 1993-2024 Alexander Roshal

Archive: links.rar
Details: RAR 5

        Name: docs/link-to-a
        Type: Unix symbolic link
      Target: a.txt
        Size: 5
 Packed size: 0
       Ratio: 0%
       mtime: 2026-11-11 10:44:03,127944105
  Attributes: lrwxrwxrwx
       CRC32: 00000000
     Host OS: Unix
 Compression: RAR 5.0(v50) -m0 -md=128k

        Name: docs/sub/报告: 2024.txt
        Type: File
        Size: 13
 Packed size: 13
       Ratio: 100%
       mtime: 2026-11-11 10:41:55,267936505
  Attributes: -rw-r--r--
       CRC32: F430BD51
     Host OS: Unix
 Compression: RAR 5.0(v50) -m0 -md=128k

        Name: docs/sub
        Type: Directory
       mtime: 2026-11-11 10:41:55,267936505
  Attributes: drwxr-xr-x
     Host OS: Unix
 Compression: RAR 5.0(v50) -m0 -md=128k

`;

/** docs/empty.txt, docs/sub/报告 2024.txt, docs/a.txt and the two folders, stored (rar 7.00). */
const TINY_RAR = "UmFyIRoHAQAzkrXlCgEFBgAFAQGAgAAfBdxDLAIDC4AABIAApIMCAAAAAIAAAQ5kb2NzL2VtcHR5LnR4dAoDE7LW82pgogkeOAuMlTYCAwuHAASHAKSDAnGqMIqAAAEYZG9jcy9zdWIv5oql5ZGKIDIwMjQudHh0CgMTstbzamCiCR7kuK3mlocKTqRTuCgCAwuGAASGAKSDAuxuYJ+AAAEKZG9jcy9hLnR4dAoDE7LW82pgogkeYWxwaGEK0W7/8yACAwsAAQDtgwGAAAEIZG9jcy9zdWIKAxOy1vNqYKIJHnK/UEAcAgMLAAEA7YMBgAABBGRvY3MKAxOy1vNqYKIJHh13VlEDBQQA";
/** One file, with the file list itself encrypted (rar -hp). */
const ENCRYPTED_RAR = "UmFyIRoHAQBAoG0XIQQAAAEPQLi8OToo5YSUSk8cC/TCD6vv1zruKMeXcY5b6GBLzQufoz3HapaocjtngQUtLElIUy2aDgfc0Q6jx3SVExi/2hgI2IsBRNvaxs5YjVf9ynmYagvlJoS2PHoQn9uKdUUfOwpEDKcyASyerYMHPzJJ7CM+QEyaYBw5Cogl1Z7daQb3QELMbiH0yGiyxm2/Rmrn85nPG1mR5w7z+oybm721Tt6KXTDAgI0qC0ysBH2UhVuLdS3urmQLY3ShR/YOQihjY+egF5Us6VUNpe1maecF2HynT20o/pa5oueXkQ==";

function installed(binary: string): boolean {
	// Windows has no `which`; choco's 7zip shim resolves via PATH extensions.
	const probe = process.platform === "win32" ? "where" : "which";
	try {
		execFileSync(probe, [binary], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

describe("listing of .7z and .rar archives", () => {
	it("reads every entry of a 7z technical listing: files as well as folders, with or without a packed size", () => {
		// The column listing was matched by a pattern that only knew the attributes "." and "D": a file is "....A",
		// so an archive showed its folders and none of its files.
		expect(parse7zTechnicalListing(SEVEN_ZIP_LISTING)).toEqual([
			{ name: "docs", size: 0, isDirectory: true, modified: "2026-11-11 10:41:55" },
			{ name: "docs/empty.txt", size: 0, isDirectory: false, modified: "2026-11-11 10:41:55" },
			{ name: "docs/a.txt", size: 19, isDirectory: false, modified: "2026-11-11 10:41:55" },
			{ name: "docs/sub/报告 = 2024.txt", size: 13, isDirectory: false, modified: "2026-11-11 10:41:55" },
		]);
		// p7zip 9.20 says "Folder = +" and gives no attributes.
		expect(parse7zTechnicalListing("----------\nPath = old\nFolder = +\nSize = 0\n\nPath = old/file\nFolder = -\nSize = 7\n")).toEqual([
			{ name: "old", size: 0, isDirectory: true },
			{ name: "old/file", size: 7, isDirectory: false },
		]);
		expect(parse7zTechnicalListing("no listing here")).toEqual([]);
	});

	it("reads every entry of an unrar technical listing", () => {
		// The column listing was matched by a pattern for a packed size, a ratio and a dd-mm-yyyy date, which unrar
		// has not printed since version 5: every RAR archive looked empty.
		expect(parseUnrarTechnicalListing(UNRAR_LISTING)).toEqual([
			{ name: "docs/link-to-a", size: 5, isDirectory: false, modified: "2026-11-11 10:44:03" },
			{ name: "docs/sub/报告: 2024.txt", size: 13, isDirectory: false, modified: "2026-11-11 10:41:55" },
			{ name: "docs/sub", size: 0, isDirectory: true, modified: "2026-11-11 10:41:55" },
		]);
		expect(parseUnrarTechnicalListing("\nUNRAR 7.00 freeware\n\njunk.rar is not RAR archive\n")).toEqual([]);
	});

	describe("with the tools themselves", () => {
		let dir = "";
		beforeEach(async () => {
			dir = await mkdtemp(path.join(tmpdir(), "vch-external-archive-"));
		});
		afterEach(async () => {
			await rm(dir, { recursive: true, force: true });
		});

		it("says which tool is missing", async () => {
			await writeFile(path.join(dir, "a.7z"), "x");
			const error = await listExternalArchive("7z", path.join(dir, "a.7z"), { binary: path.join(dir, "no-such-7z") }).catch((caught) => caught);
			expect(error).toBeInstanceOf(ExternalArchiveError);
			expect(error).toMatchObject({ code: "toolMissing", kind: "7z" });
		});

		it.skipIf(!installed("7z"))("lists a real 7z archive, solid blocks and non-ASCII names included", async () => {
			await mkdir(path.join(dir, "docs", "sub"), { recursive: true });
			await writeFile(path.join(dir, "docs", "a.txt"), "alpha");
			await writeFile(path.join(dir, "docs", "b.txt"), "beta, a little longer");
			await writeFile(path.join(dir, "docs", "sub", "报告 2024.txt"), "中文");
			execFileSync("7z", ["a", "-bso0", "-bsp0", path.join(dir, "solid.7z"), "docs"], { cwd: dir, stdio: "ignore" });

			const entries = await listExternalArchive("7z", path.join(dir, "solid.7z"));

			// Windows 7-Zip lists the archive's own name and drops empty-directory
			// entries differently; match on the files the listing must carry.
			const files = entries.filter((entry) => !entry.isDirectory).map((entry) => [entry.name, entry.size]).sort();
			expect(files).toEqual([
				["docs/a.txt", 5],
				["docs/b.txt", 21],
				["docs/sub/报告 2024.txt", 6],
			]);
			expect(entries.some((entry) => entry.isDirectory && entry.name === "docs")).toBe(true);
		}, 30_000);

		it.skipIf(!installed("7z"))("tells an encrypted file list and a damaged file apart, without waiting for a password", async () => {
			await writeFile(path.join(dir, "a.txt"), "alpha");
			execFileSync("7z", ["a", "-bso0", "-bsp0", "-mhe=on", "-pSECRET", path.join(dir, "locked.7z"), "a.txt"], { cwd: dir, stdio: "ignore" });
			await writeFile(path.join(dir, "junk.7z"), "this is not an archive");

			const started = Date.now();
			await expect(listExternalArchive("7z", path.join(dir, "locked.7z"))).rejects.toMatchObject({ code: "passwordProtected" });
			await expect(listExternalArchive("7z", path.join(dir, "junk.7z"))).rejects.toMatchObject({ code: "unreadable" });
			// The password prompt used to hold the request for the whole 15-second limit.
			expect(Date.now() - started).toBeLessThan(10_000);
		}, 30_000);

		it.skipIf(!installed("unrar"))("lists a real RAR archive with its non-ASCII names, though the service runs in the C locale", async () => {
			await writeFile(path.join(dir, "tiny.rar"), Buffer.from(TINY_RAR, "base64"));

			const entries = await listExternalArchive("rar", path.join(dir, "tiny.rar"));

			expect(entries.map((entry) => [entry.name, entry.size, entry.isDirectory]).sort()).toEqual([
				["docs", 0, true],
				["docs/a.txt", 6, false],
				["docs/empty.txt", 0, false],
				["docs/sub", 0, true],
				["docs/sub/报告 2024.txt", 7, false],
			]);
		}, 30_000);

		it.skipIf(!installed("unrar"))("tells an encrypted RAR file list and a file that is no RAR archive apart", async () => {
			await writeFile(path.join(dir, "locked.rar"), Buffer.from(ENCRYPTED_RAR, "base64"));
			await writeFile(path.join(dir, "junk.rar"), "this is not an archive");

			await expect(listExternalArchive("rar", path.join(dir, "locked.rar"))).rejects.toMatchObject({ code: "passwordProtected" });
			// unrar exits with status 0 here: an empty listing would have shown an empty archive.
			await expect(listExternalArchive("rar", path.join(dir, "junk.rar"))).rejects.toMatchObject({ code: "unreadable" });
		}, 30_000);
	});
});
