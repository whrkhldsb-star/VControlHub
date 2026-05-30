import { describe, expect, it } from "vitest";

import { createFileEntrySchema, createStorageNodeSchema } from "@/lib/storage/schema";

describe("storage schema", () => {
  it("accepts a local storage node", () => {
    const result = createStorageNodeSchema.parse({
      name: "主控本机",
      driver: "LOCAL",
      basePath: "/srv/whrkhldsb/storage",
      isDefault: true,
    });

    expect(result.driver).toBe("LOCAL");
    expect(result.basePath).toBe("/srv/whrkhldsb/storage");
  });

  it("accepts file metadata", () => {
    const result = createFileEntrySchema.parse({
      storageNodeId: "node_1",
      name: "demo.mp4",
      entryType: "FILE",
      mimeType: "video/mp4",
      size: 1024,
      relativePath: "videos/demo.mp4",
    });

    expect(result.entryType).toBe("FILE");
    expect(result.size).toBe(1024);
  });

  it("rejects invalid port ranges", () => {
    expect(() =>
      createStorageNodeSchema.parse({
        name: "远端库",
        driver: "SFTP",
        basePath: "/data/media",
        port: 70000,
      }),
    ).toThrow(/端口最大为 65535/);
  });

  it("rejects private or credentialed direct-access base URLs before persistence", () => {
    for (const publicBaseUrl of [
      "http://127.0.0.1:31888/files",
      "http://localhost:31888/files",
      "http://10.0.0.5:31888/files",
      "http://[::1]:31888/files",
      "https://user:pass@cdn.example.com/files",
      "file:///tmp/storage",
    ]) {
      expect(() =>
        createStorageNodeSchema.parse({
          name: "远端库",
          driver: "SFTP",
          basePath: "/data/media",
          host: "203.0.113.10",
          directAccessMode: "DIRECT",
          publicBaseUrl,
        }),
      ).toThrow(/公网 HTTP\(S\) 地址|格式不正确/);
    }
  });
});
