/**
 * Streaming reader for tar archives (ustar, GNU long names, PAX headers),
 * optionally gzip-compressed.
 *
 * `tar -tv` output depends on the implementation (GNU tar vs Windows/macOS
 * bsdtar) and on the locale: under the services' C locale GNU tar prints
 * `中文` as `\344\270\255\346\226\207`. Reading the headers directly gives the
 * real names and the entry types, so links and devices are never extracted.
 */
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";

export type TarMemberType = "file" | "directory" | "symlink" | "hardlink" | "other";

export type TarMember = {
	name: string;
	type: TarMemberType;
	size: number;
	modified: Date | null;
};

export class TarFormatError extends Error {}

const BLOCK = 512;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const gb18030 = new TextDecoder("gb18030");

function decodeName(bytes: Buffer): string {
	const end = bytes.indexOf(0);
	const raw = end === -1 ? bytes : bytes.subarray(0, end);
	try {
		return utf8.decode(raw);
	} catch {
		return gb18030.decode(raw);
	}
}

/** Octal field, or GNU base-256 when the high bit of the first byte is set. */
function readNumber(field: Buffer): number {
	if (field[0]! & 0x80) {
		let value = 0;
		for (let index = 1; index < field.length; index++) value = value * 256 + field[index]!;
		return value;
	}
	const text = field.toString("latin1").replace(/\0[\s\S]*$/, "").trim();
	return text ? Number.parseInt(text, 8) : 0;
}

function validChecksum(header: Buffer): boolean {
	const stored = readNumber(header.subarray(148, 156));
	let sum = 0;
	for (let index = 0; index < BLOCK; index++) sum += index >= 148 && index < 156 ? 0x20 : header[index]!;
	return sum === stored;
}

function parsePax(body: Buffer): Record<string, string> {
	const records: Record<string, string> = {};
	let offset = 0;
	while (offset < body.length) {
		const space = body.indexOf(0x20, offset);
		if (space === -1) break;
		const length = Number.parseInt(body.toString("latin1", offset, space), 10);
		if (!Number.isFinite(length) || length <= 0) break;
		const record = body.toString("utf8", space + 1, offset + length - 1);
		const equals = record.indexOf("=");
		if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1);
		offset += length;
	}
	return records;
}

/** Pulls exact byte counts out of an async chunk source. */
class ByteReader {
	private readonly iterator: AsyncIterator<Buffer>;
	private pending: Buffer = Buffer.alloc(0);
	private ended = false;

	constructor(source: AsyncIterable<Buffer>) {
		this.iterator = source[Symbol.asyncIterator]();
	}

	private async fill(minimum: number) {
		while (this.pending.length < minimum && !this.ended) {
			const next = await this.iterator.next();
			if (next.done) this.ended = true;
			else this.pending = this.pending.length ? Buffer.concat([this.pending, next.value]) : next.value;
		}
	}

	/** `length` bytes, or null at a clean end of input. */
	async read(length: number): Promise<Buffer | null> {
		await this.fill(length);
		if (this.pending.length === 0) return null;
		if (this.pending.length < length) throw new TarFormatError("Truncated tar archive");
		const out = this.pending.subarray(0, length);
		this.pending = this.pending.subarray(length);
		return out;
	}

	/** Yields the next `length` bytes in chunks as they arrive. */
	async *take(length: number): AsyncGenerator<Buffer> {
		let left = length;
		while (left > 0) {
			if (this.pending.length === 0) {
				await this.fill(1);
				if (this.pending.length === 0) throw new TarFormatError("Truncated tar archive");
			}
			const chunk = this.pending.subarray(0, Math.min(left, this.pending.length));
			this.pending = this.pending.subarray(chunk.length);
			left -= chunk.length;
			yield chunk;
		}
	}

	async skip(length: number) {
		for await (const chunk of this.take(length)) void chunk;
	}
}

async function readAll(chunks: AsyncIterable<Buffer>, limit: number): Promise<Buffer> {
	const parts: Buffer[] = [];
	let total = 0;
	for await (const chunk of chunks) {
		total += chunk.length;
		if (total > limit) throw new TarFormatError("Oversized tar extension header");
		parts.push(chunk);
	}
	return Buffer.concat(parts);
}

/**
 * Calls `visit` for every member, with its content as chunks (empty for
 * anything but files). Whatever `visit` leaves unread is skipped.
 */
export async function walkTar(
	filePath: string,
	gzip: boolean,
	visit: (member: TarMember, content: AsyncIterable<Buffer>) => Promise<void>,
): Promise<void> {
	const file = createReadStream(filePath);
	const source = gzip ? file.pipe(createGunzip()) : file;
	if (gzip) file.on("error", (error) => source.destroy(error));
	const reader = new ByteReader(source);
	let longName: string | null = null;
	let pax: Record<string, string> = {};
	try {
		for (;;) {
			const header = await reader.read(BLOCK);
			if (!header || header.every((byte) => byte === 0)) break;
			if (!validChecksum(header)) throw new TarFormatError("Not a tar archive (bad header checksum)");
			const typeflag = String.fromCharCode(header[156]!);
			const size = pax.size ? Number(pax.size) : readNumber(header.subarray(124, 136));
			const padded = Math.ceil(size / BLOCK) * BLOCK;
			if (typeflag === "L" || typeflag === "x" || typeflag === "K" || typeflag === "g") {
				const body = await readAll(reader.take(size), 1024 * 1024);
				await reader.skip(padded - size);
				if (typeflag === "L") longName = decodeName(body);
				else if (typeflag === "x") pax = { ...pax, ...parsePax(body) };
				continue;
			}
			const magic = header.toString("latin1", 257, 262);
			const prefix = magic === "ustar" ? decodeName(header.subarray(345, 500)) : "";
			const baseName = decodeName(header.subarray(0, 100));
			const name = pax.path ?? longName ?? (prefix ? `${prefix}/${baseName}` : baseName);
			const type: TarMemberType =
				typeflag === "0" || typeflag === "\0" || typeflag === "7" ? (name.endsWith("/") ? "directory" : "file")
				: typeflag === "5" ? "directory"
				: typeflag === "2" ? "symlink"
				: typeflag === "1" ? "hardlink"
				: "other";
			const mtime = pax.mtime ? Number(pax.mtime) : readNumber(header.subarray(136, 148));
			longName = null;
			pax = {};
			const member: TarMember = { name, type, size: type === "file" ? size : 0, modified: mtime > 0 ? new Date(mtime * 1000) : null };
			let consumed = 0;
			const readable = member.size;
			const content: AsyncIterable<Buffer> = {
				async *[Symbol.asyncIterator]() {
					for await (const chunk of reader.take(readable - consumed)) {
						consumed += chunk.length;
						yield chunk;
					}
				},
			};
			await visit(member, content);
			// Skip what the visitor did not read, then the block padding.
			await reader.skip(size - consumed);
			await reader.skip(padded - size);
		}
	} finally {
		source.destroy();
		file.destroy();
	}
}
