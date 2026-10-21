/**
 * Byte-level ZIP and tar builders for tests. They write what real tools do
 * and also what hostile archives do (`../` names, links, forged sizes, GBK
 * names without the UTF-8 flag), with no external binary, so the tests run
 * the same on Linux and Windows.
 */
import { crc32, deflateRawSync } from "node:zlib";

export type ZipFixtureEntry = {
	name: string | Buffer;
	data?: string | Buffer;
	directory?: boolean;
	/** Unix symlink pointing at `data`. */
	symlink?: boolean;
	deflate?: boolean;
	/** Set the UTF-8 name flag (default true for string names). */
	utf8?: boolean;
	/** Overrides the uncompressed size written to the central directory. */
	declaredSize?: number;
	encrypted?: boolean;
	method?: number;
};

export function zipFixture(entries: ZipFixtureEntry[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const rawName = typeof entry.name === "string" ? Buffer.from(entry.directory && !entry.name.endsWith("/") ? `${entry.name}/` : entry.name, "utf8") : entry.name;
		const data = Buffer.from(entry.data ?? "");
		const method = entry.method ?? (entry.deflate ? 8 : 0);
		const stored = method === 8 ? deflateRawSync(data) : data;
		const flags = (entry.utf8 ?? typeof entry.name === "string" ? 0x0800 : 0) | (entry.encrypted ? 1 : 0);
		const mode = entry.symlink ? 0o120777 : entry.directory ? 0o040755 : 0o100644;
		const crc = crc32(data);
		const size = entry.declaredSize ?? data.length;
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(flags, 6);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(stored.length, 18);
		local.writeUInt32LE(size, 22);
		local.writeUInt16LE(rawName.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE((3 << 8) | 20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(flags, 8);
		central.writeUInt16LE(method, 10);
		central.writeUInt16LE((10 << 11) | (30 << 5), 12);
		central.writeUInt16LE(((2026 - 1980) << 9) | (10 << 5) | 21, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(stored.length, 20);
		central.writeUInt32LE(size, 24);
		central.writeUInt16LE(rawName.length, 28);
		central.writeUInt32LE((mode << 16) >>> 0, 38);
		central.writeUInt32LE(offset, 42);
		locals.push(local, rawName, stored);
		centrals.push(central, rawName);
		offset += 30 + rawName.length + stored.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}

export type TarFixtureEntry = {
	name: string;
	data?: string | Buffer;
	/** "0" file (default), "5" directory, "2" symlink, "1" hard link, "3" char device. */
	type?: "0" | "5" | "2" | "1" | "3";
	linkName?: string;
	/** How a long name is stored: GNU `L` record or PAX `path`. */
	longName?: "gnu" | "pax";
};

function tarHeader(name: Buffer, size: number, type: string, linkName = ""): Buffer {
	const header = Buffer.alloc(512);
	name.copy(header, 0, 0, Math.min(name.length, 100));
	header.write("0000644\0", 100, "latin1");
	header.write("0000000\0", 108, "latin1");
	header.write("0000000\0", 116, "latin1");
	header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "latin1");
	header.write(`${Math.floor(Date.UTC(2026, 9, 21) / 1000).toString(8).padStart(11, "0")}\0`, 136, "latin1");
	header.write("        ", 148, "latin1");
	header.write(type, 156, "latin1");
	header.write(linkName, 157, "utf8");
	header.write("ustar\0" + "00", 257, "latin1");
	let sum = 0;
	for (const byte of header) sum += byte;
	header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
	return header;
}

function padded(data: Buffer): Buffer {
	return Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

export function tarFixture(entries: TarFixtureEntry[]): Buffer {
	const blocks: Buffer[] = [];
	for (const entry of entries) {
		const data = Buffer.from(entry.data ?? "");
		const type = entry.type ?? "0";
		const name = Buffer.from(entry.name, "utf8");
		if (entry.longName === "gnu") {
			blocks.push(tarHeader(Buffer.from("././@LongLink"), name.length + 1, "L"), padded(Buffer.concat([name, Buffer.from([0])])));
		} else if (entry.longName === "pax") {
			const body = (record: string) => {
				// "<length> path=<value>\n", where the length counts itself.
				const rest = Buffer.byteLength(` ${record}\n`);
				let length = rest + 1;
				while (String(length).length + rest !== length) length++;
				return Buffer.from(`${length} ${record}\n`, "utf8");
			};
			const pax = body(`path=${entry.name}`);
			blocks.push(tarHeader(Buffer.from("PaxHeader"), pax.length, "x"), padded(pax));
		}
		blocks.push(tarHeader(entry.longName ? name.subarray(0, 99) : name, type === "0" ? data.length : 0, type, entry.linkName));
		if (type === "0") blocks.push(padded(data));
	}
	blocks.push(Buffer.alloc(1024));
	return Buffer.concat(blocks);
}
