import { crc32, deflateRawSync } from "node:zlib";

export type ZipEntryInput = {
  /** Path inside the zip, e.g. `deploy.sh` or `systemd/app.service`. Forward slashes are normalised. */
  name: string;
  /** UTF-8 string or raw buffer payload. */
  content: string | Buffer;
  /**
   * Unix file mode recorded in the archive. Defaults to {@link DEFAULT_FILE_MODE};
   * pass 0o755 for a script so it stays runnable after extraction.
   */
  mode?: number;
};

const ZIP_SIGNATURE_LOCAL = 0x04034b50;
const ZIP_SIGNATURE_CENTRAL = 0x02014b50;
const ZIP_SIGNATURE_EOCD = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_METHOD_DEFLATE = 8;
const ZIP_METHOD_STORE = 0;
/**
 * Bit 11 of the general-purpose flags declares the entry name as UTF-8. Names
 * are always encoded as UTF-8 below, and without this bit an extractor is
 * entitled to read them as CP437 and mangle every non-ASCII character.
 */
const ZIP_FLAG_UTF8 = 0x0800;
/** "Version made by" host 3 = UNIX, which is what makes the mode bits below meaningful. */
const ZIP_MADE_BY_UNIX = (3 << 8) | ZIP_VERSION;
/** S_IFREG — the archive only ever holds regular files. */
const UNIX_REGULAR_FILE = 0o100000;
const DEFAULT_FILE_MODE = 0o644;

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  return { date: dosDate, time: dosTime };
}

function normaliseEntryName(name: string): string {
  const cleaned = name.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.length === 0) {
    throw new Error("zip entry name must not be empty");
  }
  if (cleaned.includes("\0")) {
    throw new Error("zip entry name must not contain NUL");
  }
  // Reject path traversal and absolute-looking residual segments so extractors
  // cannot write outside the intended package directory.
  const segments = cleaned.split("/");
  if (segments.some((seg) => seg === ".." || seg === "")) {
    throw new Error("zip entry name must not contain path traversal or empty segments");
  }
  return cleaned;
}

type CompressedEntry = {
  raw: Buffer;
  compressed: Buffer;
  crc: number;
  method: number;
  uncompressedSize: number;
  compressedSize: number;
};

function compressEntry(content: string | Buffer): CompressedEntry {
  const raw = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  const crc = crc32(raw);
  if (raw.length === 0) {
    return {
      raw,
      compressed: raw,
      crc,
      method: ZIP_METHOD_STORE,
      uncompressedSize: 0,
      compressedSize: 0,
    };
  }
  const deflated = deflateRawSync(raw);
  return {
    raw,
    compressed: deflated,
    crc,
    method: ZIP_METHOD_DEFLATE,
    uncompressedSize: raw.length,
    compressedSize: deflated.length,
  };
}

function localHeader(
  name: Buffer,
  entry: CompressedEntry,
  date: number,
  time: number,
): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(ZIP_SIGNATURE_LOCAL, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_FLAG_UTF8, 6); // general purpose bit flag
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressedSize, 18);
  header.writeUInt32LE(entry.uncompressedSize, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28); // extra field length
  return Buffer.concat([header, name, entry.compressed]);
}

function centralEntry(
  name: Buffer,
  entry: CompressedEntry,
  date: number,
  time: number,
  offset: number,
  mode: number,
): Buffer {
  const head = Buffer.alloc(46);
  head.writeUInt32LE(ZIP_SIGNATURE_CENTRAL, 0);
  head.writeUInt16LE(ZIP_MADE_BY_UNIX, 4); // version made by
  head.writeUInt16LE(ZIP_VERSION, 6); // version needed
  head.writeUInt16LE(ZIP_FLAG_UTF8, 8); // general purpose
  head.writeUInt16LE(entry.method, 10);
  head.writeUInt16LE(time, 12);
  head.writeUInt16LE(date, 14);
  head.writeUInt32LE(entry.crc, 16);
  head.writeUInt32LE(entry.compressedSize, 20);
  head.writeUInt32LE(entry.uncompressedSize, 24);
  head.writeUInt16LE(name.length, 28);
  head.writeUInt16LE(0, 30); // extra
  head.writeUInt16LE(0, 32); // comment
  head.writeUInt16LE(0, 34); // disk
  head.writeUInt16LE(0, 36); // internal attrs
  // Unix permissions live in the high 16 bits. Without them everything extracts
  // as 0644 and the package's own deploy.sh cannot be executed.
  head.writeUInt32LE(((UNIX_REGULAR_FILE | (mode & 0o7777)) * 0x10000) >>> 0, 38);
  head.writeUInt32LE(offset, 42); // relative offset of local header
  return Buffer.concat([head, name]);
}

function endOfCentralDirectory(count: number, centralSize: number, centralOffset: number): Buffer {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(ZIP_SIGNATURE_EOCD, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  return eocd;
}

/**
 * Build a single-buffer zip archive. Uses DEFLATE for non-empty entries and
 * STORE for empty ones. No streaming, no zip64 — the deploy export package is
 * tiny (a handful of KB) so the whole archive fits in memory. An entry larger
 * than 4 GiB (or a 65 536th entry) makes the header writes throw rather than
 * silently truncate.
 *
 * The output is a standard PKZIP file readable by `unzip`, macOS Archive
 * Utility, Windows Explorer, and the browser-side File System Access API.
 */
export function buildZip(entries: ZipEntryInput[], options: { mtime?: Date } = {}): Buffer {
  const mtime = options.mtime ?? new Date();
  const { date, time } = dosDateTime(mtime);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(normaliseEntryName(entry.name), "utf-8");
    const compressed = compressEntry(entry.content);
    const local = localHeader(name, compressed, date, time);
    localParts.push(local);
    centralParts.push(
      centralEntry(name, compressed, date, time, offset, entry.mode ?? DEFAULT_FILE_MODE),
    );
    offset += local.length;
  }

  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);
  const eocd = endOfCentralDirectory(entries.length, centralBuf.length, localBuf.length);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

