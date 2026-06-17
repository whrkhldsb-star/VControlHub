import { crc32, deflateRawSync } from "node:zlib";

export type ZipEntryInput = {
  /** Path inside the zip, e.g. `deploy.sh` or `systemd/app.service`. Forward slashes are normalised. */
  name: string;
  /** UTF-8 string or raw buffer payload. */
  content: string | Buffer;
};

const ZIP_SIGNATURE_LOCAL = 0x04034b50;
const ZIP_SIGNATURE_CENTRAL = 0x02014b50;
const ZIP_SIGNATURE_EOCD = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_METHOD_DEFLATE = 8;
const ZIP_METHOD_STORE = 0;

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
  header.writeUInt16LE(0, 6); // general purpose bit flag
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
): Buffer {
  const head = Buffer.alloc(46);
  head.writeUInt32LE(ZIP_SIGNATURE_CENTRAL, 0);
  head.writeUInt16LE(ZIP_VERSION, 4); // version made by
  head.writeUInt16LE(ZIP_VERSION, 6); // version needed
  head.writeUInt16LE(0, 8); // general purpose
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
  head.writeUInt32LE(0, 38); // external attrs
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
 * tiny (a handful of KB) so the whole archive fits in memory.
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
    centralParts.push(centralEntry(name, compressed, date, time, offset));
    offset += local.length;
  }

  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);
  const eocd = endOfCentralDirectory(entries.length, centralBuf.length, localBuf.length);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

/**
 * Browser-friendly helper: trigger a download of the archive in the current tab.
 * Only meaningful in client components — calling it during SSR is a no-op.
 */
export function downloadZipBlob(zip: Buffer, filename: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([new Uint8Array(zip)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
