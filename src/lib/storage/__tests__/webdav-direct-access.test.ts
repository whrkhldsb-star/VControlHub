import { describe, expect, it } from "vitest";
import { buildDirectAccessStrategy, buildStorageConnectionSummary } from "../service-direct-access";

describe("WebDAV direct access strategy", () => {
  it.each(["file.bin", "中文 文件.txt", "a#b.png"])("uses the authenticated DAV proxy for %s even with stale direct config", (relativePath) => {
    const result = buildDirectAccessStrategy({ driver: "WEBDAV", nodeId: "dav", relativePath, directAccessMode: "DIRECT", publicBaseUrl: "https://unused.example" });
    const url = new URL(result.href!, "https://hub.example");
    expect(result.mode).toBe("managed-download");
    expect(url.pathname).toBe("/api/storage/webdav-download");
    expect(url.searchParams.get("path")).toBe(relativePath);
    expect(result.description).not.toContain("SFTP");
  });
  it("does not invent SSH credentials in the connection summary", () => {
    expect(buildStorageConnectionSummary({ driver: "WEBDAV", basePath: "/docs" })).toBe("WebDAV: /docs");
  });
});
