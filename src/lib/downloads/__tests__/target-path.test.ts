import { describe, expect, it } from "vitest";

import { getDownloadTargetRelativePath, resolveDownloadTargetPath } from "@/lib/downloads/target-path";

describe("resolveDownloadTargetPath", () => {
  it("keeps an absolute target when it is inside the storage node basePath", () => {
    expect(resolveDownloadTargetPath("/srv/cloud", "/srv/cloud/movies")).toBe(
      "/srv/cloud/movies",
    );
  });

  it("joins relative targets to the storage node basePath", () => {
    expect(resolveDownloadTargetPath("/srv/cloud", "movies/new")).toBe(
      "/srv/cloud/movies/new",
    );
  });

  it("uses the storage node basePath when the request omits a target", () => {
    expect(resolveDownloadTargetPath("/srv/cloud", "")).toBe("/srv/cloud");
    expect(resolveDownloadTargetPath("/srv/cloud", null)).toBe("/srv/cloud");
  });

  it("rejects absolute targets outside the storage node basePath", () => {
    expect(() => resolveDownloadTargetPath("/srv/cloud", "/etc")).toThrow(
      "下载目标路径超出存储节点根目录",
    );
  });

  it("rejects parent traversal outside the storage node basePath", () => {
    expect(() => resolveDownloadTargetPath("/srv/cloud", "../etc")).toThrow(
      "下载目标路径超出存储节点根目录",
    );
    expect(() => resolveDownloadTargetPath("/srv/cloud", "/srv/cloud/../../etc")).toThrow(
      "下载目标路径超出存储节点根目录",
    );
  });

  it("returns the relative path used for storage access checks", () => {
    expect(getDownloadTargetRelativePath("/srv/cloud", "/srv/cloud/movies/new")).toBe("movies/new");
    expect(getDownloadTargetRelativePath("/srv/cloud", "/srv/cloud")).toBe("");
  });
});
