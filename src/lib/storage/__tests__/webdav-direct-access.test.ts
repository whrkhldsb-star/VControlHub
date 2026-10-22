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

describe("node-level access descriptions", () => {
  it("give no download link without a file", async () => {
    // The node card linked "direct access" to /api/storage/direct-access?path=,
    // which always answers 400.
    const { buildDirectAccessStrategy } = await import("../service-direct-access");
    const base = { driver: "SFTP" as const, nodeId: "node-1", host: "203.0.113.4", port: 22 };
    for (const directAccessMode of ["DIRECT", "AUTO", "PROXY"] as const) {
      const node = buildDirectAccessStrategy({ ...base, directAccessMode, publicBaseUrl: "https://files.example.test" });
      expect(node.href).toBeNull();
      const file = buildDirectAccessStrategy({ ...base, directAccessMode, publicBaseUrl: "https://files.example.test", relativePath: "a.txt" });
      expect(file.href).toContain("path=a.txt");
    }
  });
});
