import { describe, expect, it } from "vitest";

import { defaultStoragePath } from "@/lib/server/default-storage-path";

describe("defaultStoragePath", () => {
  it("uses the login user's own home", () => {
    expect(defaultStoragePath("root")).toBe("/root/drive");
    expect(defaultStoragePath("ubuntu")).toBe("/home/ubuntu/drive");
    expect(defaultStoragePath(" opc ")).toBe("/home/opc/drive");
  });

  it("keeps /root/drive for a missing name or one that is not a plain path segment", () => {
    expect(defaultStoragePath(undefined)).toBe("/root/drive");
    expect(defaultStoragePath("  ")).toBe("/root/drive");
    expect(defaultStoragePath("..")).toBe("/root/drive");
    expect(defaultStoragePath("admin@corp.example")).toBe("/root/drive");
  });
});
