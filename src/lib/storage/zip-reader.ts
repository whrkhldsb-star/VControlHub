import { open, type FileHandle } from "node:fs/promises";
import { pipeline as pipeStreams, Readable, Transform, type TransformCallback } from "node:stream";
import { crc32, createInflateRaw } from "node:zlib";

/**
 * Minimal ZIP reader: the central directory, plus a stream per entry.
 *
 * It replaces `unzip -l`, whose output changes between builds (Ubuntu's 6.0
 * prints `2026-10-21 03:08`, older ones `10-21-2026 03:08`; the old parser
 * only knew the second and listed every archive as empty) and which the
 * Docker image and Windows do not ship. Reading the format directly also
 * lets the caller see symlinks and encryption before writing anything.
 */

export type ZipEntry = {
	/** Path inside the archive with `/` separators, as stored (not yet validated). */
	name: string;
	isDirectory: boolean;
	/** Unix symlink: never extracted. */
	isSymlink: boolean;
	encrypted: boolean;
	/** 0 = stored, 8 = deflate; anything else cannot be extracted here. */
	method: number;
	compressedSize: number;
	size: number;
	crc32: number;
	modified: Date | null;
	/** Offset of the entry's local header. */
	localHeaderOffset: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;
const EXTRA_ZIP64 = 0x0001;
const EXTRA_UNICODE_PATH = 0x7075;
/** Hosts whose external attributes carry a Unix mode (Unix, macOS). */
const UNIX_HOSTS = new Set([3, 19]);
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;
const MAX_COMMENT = 0xffff;

export class ZipFormatError extends Error {}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
	const buffer = Buffer.alloc(length);
	const { bytesRead } = await handle.read(buffer, 0, length, position);
	return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
const gb18030 = new TextDecoder("gb18030", { fatal: true });

/** IBM code page 437, the ZIP format's default, for bytes 0x80–0xFF. */
const CP437_HIGH =
	"ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0";

function decodeCp437(raw: Buffer): string {
	let out = "";
	for (const byte of raw) out += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80];
	return out;
}

/**
 * Names without the UTF-8 flag are in the creator's code page. Many tools
 * write UTF-8 anyway, so try that first; then GBK, what Windows in Chinese
 * writes (pure ASCII reads the same either way); then CP437, the format's
 * own default. A lenient GBK decode turned every unreadable byte into "�",
 * so "café.txt" and "cafü.txt" became one name and extraction kept one file.
 */
function decodeName(raw: Buffer, flags: number, extra: Buffer): string {
	const unicodePath = readUnicodePathExtra(extra, raw);
	if (unicodePath !== null) return unicodePath;
	if (flags & FLAG_UTF8) return raw.toString("utf8");
	for (const decoder of [utf8, gb18030]) {
		try {
			return decoder.decode(raw);
		} catch {
			// Not this encoding; try the next.
		}
	}
	return decodeCp437(raw);
}

/** Info-ZIP Unicode Path extra field (0x7075), valid only if its CRC matches the raw name. */
function readUnicodePathExtra(extra: Buffer, raw: Buffer): string | null {
	for (let offset = 0; offset + 4 <= extra.length;) {
		const id = extra.readUInt16LE(offset);
		const size = extra.readUInt16LE(offset + 2);
		const body = extra.subarray(offset + 4, offset + 4 + size);
		if (id === EXTRA_UNICODE_PATH && body.length >= 5 && body[0] === 1 && body.readUInt32LE(1) === crc32(raw)) {
			return body.subarray(5).toString("utf8");
		}
		offset += 4 + size;
	}
	return null;
}

function dosDate(date: number, time: number): Date | null {
	if (date === 0) return null;
	const year = ((date >> 9) & 0x7f) + 1980;
	const month = ((date >> 5) & 0x0f) - 1;
	const day = date & 0x1f;
	const result = new Date(year, month, day, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2);
	return Number.isNaN(result.getTime()) ? null : result;
}

/** Find the end-of-central-directory record in the last 64 KiB (+22 bytes). */
async function readEndOfCentralDirectory(handle: FileHandle, fileSize: number) {
	const tailLength = Math.min(fileSize, 22 + MAX_COMMENT);
	const tailStart = fileSize - tailLength;
	const tail = await readAt(handle, tailStart, tailLength);
	for (let offset = tail.length - 22; offset >= 0; offset--) {
		if (tail.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
		let entries = tail.readUInt16LE(offset + 10);
		let directorySize = tail.readUInt32LE(offset + 12);
		let directoryOffset = tail.readUInt32LE(offset + 16);
		const eocdPosition = tailStart + offset;
		// Where the central directory really ends: right before this record
		// (or before the ZIP64 record that replaces it).
		let directoryEnd = eocdPosition;
		if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
			const locator = eocdPosition >= 20 ? await readAt(handle, eocdPosition - 20, 20) : Buffer.alloc(0);
			if (locator.length !== 20 || locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE) {
				throw new ZipFormatError("ZIP64 locator missing");
			}
			// The stated position counts from the archive's start; with a prefix
			// the record sits right before the locator instead.
			let zip64Position = Number(locator.readBigUInt64LE(8));
			let zip64 = await readAt(handle, zip64Position, 56);
			if ((zip64.length !== 56 || zip64.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) && eocdPosition >= 76) {
				zip64Position = eocdPosition - 20 - 56;
				zip64 = await readAt(handle, zip64Position, 56);
			}
			if (zip64.length !== 56 || zip64.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) {
				throw new ZipFormatError("ZIP64 end of central directory missing");
			}
			entries = Number(zip64.readBigUInt64LE(32));
			directorySize = Number(zip64.readBigUInt64LE(40));
			directoryOffset = Number(zip64.readBigUInt64LE(48));
			directoryEnd = zip64Position;
		}
		// Offsets count from the start of the ZIP data. An archive behind a
		// prefix (a self-extracting stub, a launcher script before a JAR) has
		// its data shifted by the prefix's length; every offset moves with it.
		const prefix = directoryEnd - directorySize - directoryOffset;
		if (prefix < 0) throw new ZipFormatError("Central directory lies outside the file");
		return { entries, directorySize, directoryOffset: directoryOffset + prefix, prefix };
	}
	throw new ZipFormatError("Not a ZIP archive (no end of central directory)");
}

/** List every entry of the ZIP at `filePath`, or of an already open handle. */
export async function readZipEntries(source: string | FileHandle, limits: { maxEntries?: number } = {}): Promise<ZipEntry[]> {
	const handle = typeof source === "string" ? await open(source, "r") : source;
	try {
		const { size: fileSize } = await handle.stat();
		const { entries, directorySize, directoryOffset, prefix } = await readEndOfCentralDirectory(handle, fileSize);
		if (limits.maxEntries !== undefined && entries > limits.maxEntries) {
			throw new ZipFormatError(`Archive has ${entries} entries (limit ${limits.maxEntries})`);
		}
		if (directoryOffset + directorySize > fileSize) throw new ZipFormatError("Central directory lies outside the file");
		const directory = await readAt(handle, directoryOffset, directorySize);
		const result: ZipEntry[] = [];
		let offset = 0;
		for (let index = 0; index < entries; index++) {
			if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
				throw new ZipFormatError("Corrupt central directory");
			}
			const madeBy = directory.readUInt16LE(offset + 4) >> 8;
			const flags = directory.readUInt16LE(offset + 8);
			const method = directory.readUInt16LE(offset + 10);
			const time = directory.readUInt16LE(offset + 12);
			const date = directory.readUInt16LE(offset + 14);
			const crc = directory.readUInt32LE(offset + 16);
			let compressedSize = directory.readUInt32LE(offset + 20);
			let size = directory.readUInt32LE(offset + 24);
			const nameLength = directory.readUInt16LE(offset + 28);
			const extraLength = directory.readUInt16LE(offset + 30);
			const commentLength = directory.readUInt16LE(offset + 32);
			const externalAttributes = directory.readUInt32LE(offset + 38);
			let localHeaderOffset = directory.readUInt32LE(offset + 42);
			const rawName = directory.subarray(offset + 46, offset + 46 + nameLength);
			const extra = directory.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength);
			// ZIP64 extra field: only the fields saturated in the header are present, in this order.
			for (let cursor = 0; cursor + 4 <= extra.length;) {
				const id = extra.readUInt16LE(cursor);
				const fieldSize = extra.readUInt16LE(cursor + 2);
				if (id === EXTRA_ZIP64) {
					let field = cursor + 4;
					if (size === 0xffffffff) { size = Number(extra.readBigUInt64LE(field)); field += 8; }
					if (compressedSize === 0xffffffff) { compressedSize = Number(extra.readBigUInt64LE(field)); field += 8; }
					if (localHeaderOffset === 0xffffffff) { localHeaderOffset = Number(extra.readBigUInt64LE(field)); }
				}
				cursor += 4 + fieldSize;
			}
			const name = decodeName(rawName, flags, extra).replace(/\\/g, "/");
			const mode = UNIX_HOSTS.has(madeBy) ? externalAttributes >>> 16 : 0;
			result.push({
				name,
				isDirectory: name.endsWith("/") || (mode & S_IFMT) === S_IFDIR || (externalAttributes & 0x10) !== 0,
				isSymlink: (mode & S_IFMT) === S_IFLNK,
				encrypted: (flags & FLAG_ENCRYPTED) !== 0,
				method,
				compressedSize,
				size,
				crc32: crc,
				modified: dosDate(date, time),
				localHeaderOffset: localHeaderOffset + prefix,
			});
			offset += 46 + nameLength + extraLength + commentLength;
		}
		return result;
	} finally {
		if (typeof source === "string") await handle.close();
	}
}

/** Fails the stream when the data is longer than declared or its CRC is wrong. */
class ZipEntryVerifier extends Transform {
	private written = 0;
	private crc = 0;
	constructor(private readonly entry: ZipEntry) {
		super();
	}
	override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
		this.written += chunk.length;
		if (this.written > this.entry.size) {
			callback(new ZipFormatError(`${this.entry.name}: more data than the archive declares`));
			return;
		}
		this.crc = crc32(chunk, this.crc);
		callback(null, chunk);
	}
	override _flush(callback: TransformCallback) {
		if (this.written !== this.entry.size) callback(new ZipFormatError(`${this.entry.name}: truncated data`));
		else if (this.crc !== this.entry.crc32) callback(new ZipFormatError(`${this.entry.name}: CRC mismatch`));
		else callback();
	}
}

/**
 * `length` bytes from `start` by positional reads. FileHandle.createReadStream
 * leaves a `close` listener on the handle for every stream it makes, so an
 * archive with more than ten entries tripped Node's listener-leak warning.
 */
function readRange(handle: FileHandle, start: number, length: number): Readable {
	return Readable.from((async function* () {
		let position = start;
		let left = length;
		while (left > 0) {
			const size = Math.min(left, 64 * 1024);
			const { bytesRead, buffer } = await handle.read(Buffer.allocUnsafe(size), 0, size, position);
			if (bytesRead === 0) throw new ZipFormatError("Unexpected end of archive");
			position += bytesRead;
			left -= bytesRead;
			yield buffer.subarray(0, bytesRead);
		}
	})(), { objectMode: false });
}

/**
 * The decompressed bytes of one entry, checked against the size and CRC in
 * the central directory (a forged size cannot inflate past it).
 */
export async function openZipEntryStream(handle: FileHandle, entry: ZipEntry): Promise<Readable> {
	if (entry.encrypted) throw new ZipFormatError(`${entry.name}: encrypted entries are not supported`);
	if (entry.method !== 0 && entry.method !== 8) throw new ZipFormatError(`${entry.name}: compression method ${entry.method} is not supported`);
	const header = await readAt(handle, entry.localHeaderOffset, 30);
	if (header.length !== 30 || header.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new ZipFormatError(`${entry.name}: local header missing`);
	const dataStart = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
	const verifier = new ZipEntryVerifier(entry);
	if (entry.compressedSize === 0) {
		verifier.end();
		return verifier;
	}
	const raw = readRange(handle, dataStart, entry.compressedSize);
	// pipeline() tears every stage down on the first error and leaves it on the verifier, which the caller reads.
	const done = (error?: Error | null) => {
		if (error && !verifier.destroyed) verifier.destroy(error);
	};
	if (entry.method === 8) pipeStreams(raw, createInflateRaw(), verifier, done);
	else pipeStreams(raw, verifier, done);
	return verifier;
}
