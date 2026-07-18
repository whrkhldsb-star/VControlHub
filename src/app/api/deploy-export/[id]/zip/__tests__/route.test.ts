import { describe, expect, it, vi, beforeEach } from "vitest";
import { inflateRawSync } from "node:zlib";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    findUnique: vi.fn(),
    audit: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    deploymentExport: { findUnique: mocks.findUnique },
  },
}));

vi.mock("@/lib/audit/service", () => ({
  auditUserAction: mocks.audit,
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: vi.fn(() => false),
}));

vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: vi.fn(async (_request, _options, handler) => {
    try {
      return await handler({ session: { userId: "u1" }, body: undefined, query: undefined });
    } catch (e) {
      const { apiCatch } = await import("@/lib/http/api-error");
      return apiCatch(e);
    }
  }),
}));

const route = await import("../route");

describe("/api/deploy-export/[id]/zip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams a valid ZIP archive for an existing export and records an audit event", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "exp1",
      name: "vcontrolhub-portable",
      manifest: { appName: "vcontrolhub", domain: "console.example.test" },
      files: {
        "deploy.sh": "#!/usr/bin/env bash\nset -euo pipefail\necho hi\n",
        "Caddyfile.example": "example.com { reverse_proxy 127.0.0.1:3000 }\n",
        "env.production.example": 'DATABASE_URL="REPLACE_ME"\n',
      },
      createdBy: "u1",
      createdAt: new Date("2026-06-16T00:00:00Z"),
    });

    const res = await route.GET(
      new Request("http://local/api/deploy-export/exp1/zip"),
      { params: Promise.resolve({ id: "exp1" }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="vcontrolhub-portable.zip"',
    );
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(mocks.audit).toHaveBeenCalledWith(
      "u1",
      "deployment.export.download",
      expect.objectContaining({ exportId: "exp1", fileCount: 3 }),
      undefined, undefined,
    );

    // Spot-check the archive is a real PKZIP file we can decode.
    expect(buffer.readUInt32LE(0)).toBe(0x04034b50);
    const eocdOffset = buffer.length - 22;
    expect(buffer.readUInt32LE(eocdOffset)).toBe(0x06054b50);
    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    expect(entryCount).toBe(3);

    // The first entry should be `deploy.sh` (insertion order); decode its
    // compressed payload to confirm the encoder is wired through the route.
    const localNameLength = buffer.readUInt16LE(26);
    expect(buffer.slice(30, 30 + localNameLength).toString("utf-8")).toBe("deploy.sh");
    const dataStart = 30 + localNameLength;
    const compressedSize = buffer.readUInt32LE(18);
    const deflated = buffer.subarray(dataStart, dataStart + compressedSize);
    const inflated = inflateRawSync(deflated).toString("utf-8");
    expect(inflated).toContain("set -euo pipefail");
  });

  it("returns 404 when the export id does not exist", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const res = await route.GET(
      new Request("http://local/api/deploy-export/missing/zip"),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(res.status).toBe(404);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("returns 404 when a non-owner without team:manage requests the zip", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "exp2",
      name: "other-portable",
      manifest: { appName: "other", domain: "other.example.test" },
      files: { "deploy.sh": "echo x\n" },
      createdBy: "other-user",
      createdAt: new Date("2026-06-16T00:00:00Z"),
    });
    const res = await route.GET(
      new Request("http://local/api/deploy-export/exp2/zip"),
      { params: Promise.resolve({ id: "exp2" }) },
    );
    expect(res.status).toBe(404);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
