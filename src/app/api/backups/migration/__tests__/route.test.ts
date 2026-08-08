import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, validateMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  validateMock: vi.fn(),
}));

vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: vi.fn(async (_request, _options, handler) => handler({
    session: { userId: "u1", roles: ["operator"], currentTeamId: "team-1" },
    body: undefined,
  })),
}));
vi.mock("@/lib/backup/migration-package", () => ({
  exportMigrationPackage: vi.fn(),
  importMigrationPackage: vi.fn(),
  listMigrationPackages: listMock,
  validateMigrationPackage: validateMock,
}));

import { GET } from "../route";

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
});
