import { describe, expect, it, vi } from "vitest";

// Import pure functions — no SSH connection needed
import {
  sanitizeRemotePath,
  sanitizeFileName,
} from "@/lib/ssh/sftp-service";

// Mock dependencies so module loads cleanly
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/ssh/ssh-key-crypto", () => ({
  decryptServerPassword: (v: string) => v,
  decryptSshPrivateKey: (v: string) => v,
}));

describe("sanitizeRemotePath", () => {
  it("normalises consecutive slashes", () => {
    expect(sanitizeRemotePath("//root//home")).toBe("/root/home");
    expect(sanitizeRemotePath("/root///file.txt")).toBe("/root/file.txt");
  });

  it("rejects empty string", () => {
    expect(() => sanitizeRemotePath("")).toThrow("non-empty");
  });

  it("rejects null bytes", () => {
    expect(() => sanitizeRemotePath("/root\0/evil")).toThrow("null bytes");
  });

  it("rejects paths exceeding 4096 chars", () => {
    expect(() => sanitizeRemotePath("/" + "a".repeat(4097))).toThrow("maximum length");
  });

  it("accepts standard absolute paths", () => {
    expect(sanitizeRemotePath("/root/.bashrc")).toBe("/root/.bashrc");
    expect(sanitizeRemotePath("/var/log/nginx/access.log")).toBe("/var/log/nginx/access.log");
  });

  it("accepts relative paths", () => {
    expect(sanitizeRemotePath("./foo/bar")).toBe("./foo/bar");
    expect(sanitizeRemotePath("~/documents")).toBe("~/documents");
  });
});

describe("sanitizeFileName", () => {
  it("rejects empty string", () => {
    expect(() => sanitizeFileName("")).toThrow("non-empty");
  });

  it("rejects path separators", () => {
    expect(() => sanitizeFileName("foo/bar")).toThrow("Invalid filename");
    expect(() => sanitizeFileName("foo\\..\\bar")).toThrow("Invalid filename");
  });

  it("rejects null bytes", () => {
    expect(() => sanitizeFileName("file\0.txt")).toThrow("Invalid filename");
  });

  it("rejects names exceeding 255 chars", () => {
    expect(() => sanitizeFileName("a".repeat(256))).toThrow("maximum length");
  });

  it("accepts valid filenames", () => {
    expect(sanitizeFileName("backup.tar.gz")).toBe("backup.tar.gz");
    expect(sanitizeFileName(".bashrc")).toBe(".bashrc");
    expect(sanitizeFileName("my-file_v2.txt")).toBe("my-file_v2.txt");
  });
});
