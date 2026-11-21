import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, validateMock, exportMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  validateMock: vi.fn(),
  exportMock: vi.fn(),
}));

vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: vi.fn(async (request, _options, handler) => handler({
    session: { userId: "u1", roles: ["operator"], currentTeamId: "team-1" },
    body: request.method === "POST" ? await request.json() : undefined,
  })),
}));
vi.mock("@/lib/backup/migration-package", () => ({
  exportMigrationPackage: exportMock,
  importMigrationPackage: vi.fn(),
  listMigrationPackages: listMock,
  validateMigrationPackage: validateMock,
}));

vi.mock("@/lib/audit/service", () => ({ auditUserAction: vi.fn() }));
import { GET, POST } from "../route";

describe("GET /api/backups/migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue([]);
  });

  it("passes the authenticated session into migration package listing", async () => {
    const response = await GET(new Request("https://app.example/api/backups/migration"));
    expect(response.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(undefined, {
      userId: "u1",
      roles: ["operator"],
      currentTeamId: "team-1",
    });
  });

  it.each([null, "migration-packages/example.tar.gz"])("advertises only the tarball produced by the exporter (%s)", async (tarballRelativePath) => {
    exportMock.mockResolvedValueOnce({ packageId: "example", packageRelativeDir: "migration-packages/example",
      tarballRelativePath, manifest: { backup: { type: "FULL" } } });
    const response = await POST(new Request("https://app.example/api/backups/migration", {
      method: "POST", body: JSON.stringify({ action: "export", backupId: "backup" }),
    }));
    expect(await response.json()).toMatchObject({ packageRelativeDir: "migration-packages/example", tarballRelativePath: tarballRelativePath ?? "" });
  });
});
