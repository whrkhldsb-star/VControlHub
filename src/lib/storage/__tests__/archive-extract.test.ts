import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	ArchiveExtractError,
	archiveBaseName,
	archiveKindOf,
	extractArchive,
	listArchive,
	normalizeMemberPath,
	planExtraction,
	type ArchiveKind,
} from "../archive-extract";
import { readZipEntries } from "../zip-reader";
import { tarFixture, zipFixture } from "./archive-fixtures";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), "vch-archive-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function write(name: string, bytes: Buffer) {
	const file = path.join(dir, name);
	await writeFile(file, bytes);
	return file;
}

async function extract(name: string, bytes: Buffer, kind: ArchiveKind) {
	const file = await write(name, bytes);
	const plan = await planExtraction(file, kind);
	return extractArchive({ filePath: file, kind, archiveName: name, parentDir: dir, plan });
}

async function tree(root: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
		out.push(path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/") + (entry.isDirectory() ? "/" : ""));
	}
	return out.sort();
}

describe("archive names", () => {
	it("knows the formats it reads and the folder they extract into", () => {
		expect(archiveKindOf("a.ZIP")).toBe("zip");
		expect(archiveKindOf("lib.jar")).toBe("zip");
		expect(archiveKindOf("site.tar.gz")).toBe("tar.gz");
		expect(archiveKindOf("site.tgz")).toBe("tar.gz");
		expect(archiveKindOf("site.tar")).toBe("tar");
		expect(archiveKindOf("notes.gz")).toBeNull();
		expect(archiveKindOf("x.7z")).toBeNull();
		expect(archiveBaseName("photos-2026.tar.gz")).toBe("photos-2026");
		expect(archiveBaseName(".zip")).toBe("archive");
	});

	it("keeps member paths inside the extraction root", () => {
		expect(normalizeMemberPath("./a/b.txt")).toBe("a/b.txt");
		expect(normalizeMemberPath("/etc/passwd")).toBe("etc/passwd");
		expect(normalizeMemberPath("dir\\file.txt")).toBe("dir/file.txt");
		expect(normalizeMemberPath("./")).toBeNull();
		for (const unsafe of ["../evil", "a/../../evil", "C:/Windows/x", "a\0b", "a/\u0007b"]) {
			expect(() => normalizeMemberPath(unsafe), unsafe).toThrow(ArchiveExtractError);
		}
	});
});

describe("listing", () => {
	it("lists a ZIP with UTF-8 names, folders and sizes (unzip -l listed it as empty)", async () => {
		const file = await write("bundle.zip", zipFixture([
			{ name: "报告/", directory: true },
			{ name: "报告/年度总结.txt", data: "hello", deflate: true },
			{ name: "readme.md", data: "# hi" },
		]));
		expect(await listArchive(file, "zip")).toEqual([
			{ name: "报告", size: 0, isDirectory: true, modified: expect.any(String) },
			{ name: "报告/年度总结.txt", size: 5, isDirectory: false, modified: expect.any(String) },
			{ name: "readme.md", size: 4, isDirectory: false, modified: expect.any(String) },
		]);
	});

	it("reads GBK names that Windows writes without the UTF-8 flag", async () => {
		// "中文.txt" in GBK
		const gbk = Buffer.concat([Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), Buffer.from(".txt")]);
		const file = await write("win.zip", zipFixture([{ name: gbk, data: "x", utf8: false }]));
		expect((await readZipEntries(file))[0]!.name).toBe("中文.txt");
	});

	it("lists tar.gz with real Chinese, GNU long and PAX names (GNU tar escaped them)", async () => {
		const long = `${"深".repeat(60)}/file.txt`;
		const file = await write("site.tar.gz", gzipSync(tarFixture([
			{ name: "站点/", type: "5" },
			{ name: "站点/首页.html", data: "<h1>hi</h1>" },
			{ name: long, data: "a", longName: "gnu" },
			{ name: `pax/${"长".repeat(50)}.txt`, data: "b", longName: "pax" },
			{ name: "站点/link", type: "2", linkName: "/etc/passwd" },
		])));
		const names = (await listArchive(file, "tar.gz")).map((entry) => entry.name);
		expect(names).toEqual(["站点", "站点/首页.html", long, `pax/${"长".repeat(50)}.txt`, "站点/link"]);
	});

	it("reports a damaged archive as corrupt", async () => {
		const file = await write("broken.zip", Buffer.from("not a zip at all"));
		await expect(listArchive(file, "zip")).rejects.toMatchObject({ code: "corrupt" });
		const tar = await write("broken.tar", Buffer.alloc(512, 7));
		await expect(listArchive(tar, "tar")).rejects.toMatchObject({ code: "corrupt" });
	});
});

describe("extraction", () => {
	it("extracts a ZIP with one top-level folder as that folder", async () => {
		const result = await extract("project.zip", zipFixture([
			{ name: "project/", directory: true },
			{ name: "project/src/main.ts", data: "console.log(1)", deflate: true },
			{ name: "project/README.md", data: "readme" },
		]), "zip");
		expect(result).toMatchObject({ folderName: "project", files: 2, skipped: 0 });
		expect(await tree(path.join(dir, "project"))).toEqual(["README.md", "src/", "src/main.ts"]);
		expect(await readFile(path.join(dir, "project/src/main.ts"), "utf8")).toBe("console.log(1)");
		expect(result.createdDirectories.map((d) => path.relative(dir, d).split(path.sep).join("/"))).toEqual(["project", "project/src"]);
	});

	it("names the folder after the archive when members are loose, and never reuses a taken name", async () => {
		await mkdir(path.join(dir, "photos"));
		const result = await extract("photos.tar", tarFixture([{ name: "a.jpg", data: "1" }, { name: "b.jpg", data: "2" }]), "tar");
		expect(result.folderName).toBe("photos (2)");
		expect(await tree(path.join(dir, "photos (2)"))).toEqual(["a.jpg", "b.jpg"]);
		expect(await readdir(path.join(dir, "photos"))).toEqual([]);
	});

	it("skips links and devices and writes nothing outside the folder", async () => {
		const zipResult = await extract("links.zip", zipFixture([
			{ name: "ok.txt", data: "ok" },
			{ name: "escape", data: "/etc", symlink: true },
		]), "zip");
		expect(zipResult).toMatchObject({ files: 1, skipped: 1 });
		const tarResult = await extract("links.tgz", gzipSync(tarFixture([
			{ name: "ok.txt", data: "ok" },
			{ name: "sym", type: "2", linkName: "../../etc" },
			{ name: "hard", type: "1", linkName: "/etc/passwd" },
			{ name: "dev", type: "3" },
		])), "tar.gz");
		expect(tarResult).toMatchObject({ files: 1, skipped: 3 });
		for (const folder of [zipResult.folderName, tarResult.folderName]) {
			for (const name of await tree(path.join(dir, folder))) {
				const stat = await lstat(path.join(dir, folder, name));
				expect(stat.isFile() || stat.isDirectory()).toBe(true);
			}
		}
	});

	it("refuses traversal before writing anything", async () => {
		const file = await write("evil.zip", zipFixture([{ name: "fine.txt", data: "x" }, { name: "../../evil.txt", data: "pwned" }]));
		await expect(planExtraction(file, "zip")).rejects.toMatchObject({ code: "unsafePath" });
		const tar = await write("evil.tar", tarFixture([{ name: "a/../../evil.txt", data: "pwned" }]));
		await expect(planExtraction(tar, "tar")).rejects.toMatchObject({ code: "unsafePath" });
		expect((await readdir(dir)).sort()).toEqual(["evil.tar", "evil.zip"]);
	});

	it("refuses encrypted entries, unknown methods and empty archives", async () => {
		const encrypted = await write("secret.zip", zipFixture([{ name: "a.txt", data: "x", encrypted: true }]));
		await expect(planExtraction(encrypted, "zip")).rejects.toMatchObject({ code: "encrypted" });
		const bzip = await write("bz.zip", zipFixture([{ name: "a.txt", data: "x", method: 12 }]));
		await expect(planExtraction(bzip, "zip")).rejects.toMatchObject({ code: "unsupportedMethod" });
		const empty = await write("empty.tar", tarFixture([]));
		await expect(planExtraction(empty, "tar")).rejects.toMatchObject({ code: "empty" });
	});

	it("checks the declared size against the limit before writing", async () => {
		const file = await write("bomb.zip", zipFixture([{ name: "big.bin", data: "x", declaredSize: 3 * 1024 ** 3 }]));
		await expect(planExtraction(file, "zip")).rejects.toMatchObject({ code: "tooLarge" });
	});

	it("stops an entry that inflates past its declared size and leaves no folder behind", async () => {
		const file = await write("liar.zip", zipFixture([{ name: "liar.txt", data: "x".repeat(10_000), deflate: true, declaredSize: 10 }]));
		const plan = await planExtraction(file, "zip");
		await expect(extractArchive({ filePath: file, kind: "zip", archiveName: "liar.zip", parentDir: dir, plan })).rejects.toMatchObject({ code: "corrupt" });
		expect(await readdir(dir)).toEqual(["liar.zip"]);
	});
});
