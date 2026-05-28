import { describe, expect, it } from "vitest";

import {
  normalizeRemotePath,
  normalizeRemoteRelativePath,
  normalizeRemoteTargetPath,
} from "@/lib/storage/remote-path";

describe("remote path normalization", () => {
  it("treats absolute-looking input as relative to the storage base", () => {
    expect(normalizeRemotePath("/data/file", "/movies/a.mp4")).toBe(
      "/data/file/movies/a.mp4",
    );
    expect(normalizeRemotePath("/data/file", "movies/a.mp4")).toBe(
      "/data/file/movies/a.mp4",
    );
  });

  it("keeps empty or root requests at the base path", () => {
    expect(normalizeRemotePath("/data/file", "")).toBe("/data/file");
    expect(normalizeRemotePath("/data/file", "/")).toBe("/data/file");
  });

  it("rejects parent traversal outside the storage base", () => {
    expect(() => normalizeRemotePath("/data/file", "../etc/passwd")).toThrow();
    expect(() => normalizeRemotePath("/data/file", "/../etc/passwd")).toThrow();
  });

  it("returns the canonical relative path used for authorization", () => {
    expect(normalizeRemoteRelativePath("/team-a//nested/../file.txt")).toBe("team-a/file.txt");
    expect(normalizeRemoteRelativePath("/")).toBe("");
    expect(() => normalizeRemoteRelativePath("team-a/../../secret.txt")).toThrow();
  });

  it("requires target operations to address an item under the base", () => {
    expect(() => normalizeRemoteTargetPath("/data/file", "/")).toThrow();
    expect(normalizeRemoteTargetPath("/data/file", "/upload.txt")).toBe(
      "/data/file/upload.txt",
    );
  });
});
