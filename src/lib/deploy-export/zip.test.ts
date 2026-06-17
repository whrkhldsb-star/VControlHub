import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";

import { buildZip } from "./zip";

function readUInt32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

function readUInt16LE(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}

type DecodedEntry = {
  name: string;
  raw: Buffer;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
};

function decodeZip(archive: Buffer): { entries: DecodedEntry[]; eocd: { entryCount: number; centralOffset: number; centralSize: number } } {
  expect(archive.length).toBeGreaterThan(22);
  // EOCD is 22 bytes; comment length 0 means it is the last 22 bytes.
  const eocdOffset = archive.length - 22;
  expect(readUInt32LE(archive, eocdOffset)).toBe(0x06054b50);

  const entryCount = readUInt16LE(archive, eocdOffset + 10);
  const centralSize = readUInt32LE(archive, eocdOffset + 12);
  const centralOffset = readUInt32LE(archive, eocdOffset + 16);

  const entries: DecodedEntry[] = [];
  let cursor = centralOffset;
  for (let i = 0; i < entryCount; i++) {
    expect(readUInt32LE(archive, cursor)).toBe(0x02014b50);
    const method = readUInt16LE(archive, cursor + 10);
    const crc = readUInt32LE(archive, cursor + 16);
    const compressedSize = readUInt32LE(archive, cursor + 20);
    const uncompressedSize = readUInt32LE(archive, cursor + 24);
    const nameLength = readUInt16LE(archive, cursor + 28);
    const extraLength = readUInt16LE(archive, cursor + 30);
    const commentLength = readUInt16LE(archive, cursor + 32);
    const localHeaderOffset = readUInt32LE(archive, cursor + 42);
    const name = archive.slice(cursor + 46, cursor + 46 + nameLength).toString("utf-8");

    expect(readUInt32LE(archive, localHeaderOffset)).toBe(0x04034b50);
    const localNameLength = readUInt16LE(archive, localHeaderOffset + 26);
    const dataStart = localHeaderOffset + 30 + localNameLength;
    const data = archive.slice(dataStart, dataStart + compressedSize);

    let raw: Buffer;
    if (method === 8) {
      raw = inflateRawSync(data);
    } else if (method === 0) {
      raw = data;
    } else {
      throw new Error(`unsupported method ${method} for entry ${name}`);
    }
    expect(raw.length).toBe(uncompressedSize);
    entries.push({ name, raw, method, crc, compressedSize, uncompressedSize });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  expect(cursor - centralOffset).toBe(centralSize);
  return { entries, eocd: { entryCount, centralSize, centralOffset } };
}

describe("deploy-export zip encoder", () => {
  it("emits a valid PKZIP archive that round-trips through inflateRawSync", () => {
    const archive = buildZip([
      { name: "deploy.sh", content: "#!/usr/bin/env bash\nset -euo pipefail\necho hello\n" },
      { name: "Caddyfile.example", content: "example.com {\n  encode gzip\n  reverse_proxy 127.0.0.1:3000\n}\n" },
      { name: "env.production.example", content: 'DATABASE_URL="REPLACE_ME"\nAUTH_SESSION_SECRET="placeholder"\n' },
    ]);

    const decoded = decodeZip(archive);
    expect(decoded.eocd.entryCount).toBe(3);
    expect(decoded.entries.map((entry) => entry.name)).toEqual([
      "deploy.sh",
      "Caddyfile.example",
      "env.production.example",
    ]);
    expect(decoded.entries[0]!.raw.toString("utf-8")).toContain("set -euo pipefail");
    expect(decoded.entries[1]!.raw.toString("utf-8")).toContain("reverse_proxy 127.0.0.1:3000");
    expect(decoded.entries[2]!.raw.toString("utf-8")).toContain("DATABASE_URL=\"REPLACE_ME\"");
    // DEFLATE should be at least non-empty and shorter-or-equal compared with raw text.
    for (const entry of decoded.entries) {
      expect(entry.method).toBe(8);
      expect(entry.compressedSize).toBeGreaterThan(0);
      expect(entry.compressedSize).toBeLessThanOrEqual(entry.uncompressedSize + 32);
    }
  });

  it("stores an empty file with the STORE method and a zero-length payload", () => {
    const archive = buildZip([{ name: "empty.txt", content: "" }]);
    const { entries, eocd } = decodeZip(archive);
    expect(eocd.entryCount).toBe(1);
    expect(entries[0]!.method).toBe(0);
    expect(entries[0]!.uncompressedSize).toBe(0);
    expect(entries[0]!.compressedSize).toBe(0);
    expect(entries[0]!.raw.length).toBe(0);
  });

  it("rejects empty or NUL-containing entry names", () => {
    expect(() => buildZip([{ name: "", content: "x" }])).toThrow(/must not be empty/);
    expect(() => buildZip([{ name: "foo\0bar", content: "x" }])).toThrow(/NUL/);
  });

  it("normalises leading slashes and backslashes in entry names", () => {
    const archive = buildZip([{ name: "/systemd/app.service", content: "x" }]);
    const { entries } = decodeZip(archive);
    expect(entries[0]!.name).toBe("systemd/app.service");
  });
});
