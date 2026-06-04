import { describe, expect, it } from "vitest";

import {
  getPathName,
  isSafeArchiveEntryPath,
  joinStoragePath,
  normalizeStorageRelativePath,
  normalizeStorageTargetDirectory,
  sanitizeArchiveEntries,
  resolveStoragePathWithinBase,
  expandStorageBasePath,
} from "../path-utils";

describe("storage path utils", () => {
  it("normalizes safe relative paths consistently", () => {
    expect(normalizeStorageRelativePath(" team-a//docs/报告.pdf ")).toEqual({ ok: true, path: "team-a/docs/报告.pdf" });
    expect(normalizeStorageRelativePath("team-a\\docs\\a.txt")).toEqual({ ok: true, path: "team-a/docs/a.txt" });
    expect(normalizeStorageTargetDirectory(".")).toEqual({ ok: true, path: "" });
    expect(normalizeStorageTargetDirectory(" /team-a//docs ").ok).toBe(false);
  });

  it("rejects traversal, absolute-looking roots, control chars, and shell-hostile path chars", () => {
    for (const value of [
      "../secret.txt",
      "team/../../secret.txt",
      "/etc/passwd",
      "team\u0000/a.txt",
      "team/a:name.txt",
      "team/a?.txt",
    ]) {
      expect(normalizeStorageRelativePath(value).ok).toBe(false);
    }
  });

  it("rejects empty target file path but allows empty target directory", () => {
    expect(normalizeStorageRelativePath(" ").ok).toBe(false);
    expect(normalizeStorageTargetDirectory(" ")).toEqual({ ok: true, path: "" });
  });

  it("joins directories and names without allowing unsafe names", () => {
    expect(joinStoragePath("team-a/docs", "a.txt")).toEqual({ ok: true, path: "team-a/docs/a.txt" });
    expect(joinStoragePath("", "a.txt")).toEqual({ ok: true, path: "a.txt" });
    expect(joinStoragePath("team-a", "../a.txt").ok).toBe(false);
    expect(joinStoragePath("team-a", "bad:name.txt").ok).toBe(false);
  });

  it("extracts safe names from normalized paths", () => {
    expect(getPathName("team-a/docs/a.txt")).toBe("a.txt");
    expect(getPathName("a.txt")).toBe("a.txt");
  });

  it("resolves paths only inside the configured storage root", () => {
    const resolved = resolveStoragePathWithinBase("/srv/storage", "team-a/docs/a.txt");
    expect(resolved).toEqual({ ok: true, path: "/srv/storage/team-a/docs/a.txt" });
    expect(resolveStoragePathWithinBase("/srv/storage", "../secret.png").ok).toBe(false);
    expect(resolveStoragePathWithinBase("/srv/storage", "/etc/passwd").ok).toBe(false);
  });

  it("expands portable app slug placeholders before resolving local storage roots", () => {
    const previousSlug = process.env.APP_SLUG;
    process.env.APP_SLUG = "vcontrolhub";
    try {
      expect(expandStorageBasePath("/var/lib/${APP_SLUG:-vcontrolhub}/storage")).toBe(
        "/var/lib/vcontrolhub/storage",
      );
      expect(resolveStoragePathWithinBase(
        "/var/lib/${APP_SLUG:-vcontrolhub}/storage",
        "uploads/a.txt",
      )).toEqual({ ok: true, path: "/var/lib/vcontrolhub/storage/uploads/a.txt" });
    } finally {
      if (previousSlug === undefined) {
        delete process.env.APP_SLUG;
      } else {
        process.env.APP_SLUG = previousSlug;
      }
    }
  });

  it("detects archive entries that could escape during extraction", () => {
    expect(isSafeArchiveEntryPath("folder/photo.png")).toBe(true);
    expect(isSafeArchiveEntryPath("../secret.txt")).toBe(false);
    expect(isSafeArchiveEntryPath("folder/../../secret.txt")).toBe(false);
    expect(isSafeArchiveEntryPath("/absolute.txt")).toBe(false);
    expect(isSafeArchiveEntryPath("C:/Windows/system.ini")).toBe(false);
    expect(isSafeArchiveEntryPath("folder\\..\\secret.txt")).toBe(false);
    expect(isSafeArchiveEntryPath("folder/file:ads.txt")).toBe(false);
    expect(isSafeArchiveEntryPath("folder/./photo.png")).toBe(true);
    expect(isSafeArchiveEntryPath("folder/../../secret.txt")).toBe(false);
    expect(isSafeArchiveEntryPath(`folder/${"a".repeat(256)}.txt`)).toBe(false);
    expect(isSafeArchiveEntryPath("folder/bad\u0000name.txt")).toBe(false);
  });

  it("filters unsafe archive entries before returning them to clients", () => {
    const entries = sanitizeArchiveEntries([
      { name: "folder/photo.png", size: 1 },
      { name: "../secret.txt", size: 2 },
      { name: "folder/../../escape.txt", size: 3 },
      { name: "C:/Windows/system.ini", size: 4 },
    ]);

    expect(entries).toEqual([{ name: "folder/photo.png", size: 1 }]);
  });
});
