import { beforeEach, describe, expect, it, vi } from "vitest";

const { guardMock, importMock, auditMock } = vi.hoisted(() => ({
  guardMock: { roles: ["admin"] as string[] },
  importMock: { previewImport: vi.fn(), executeImport: vi.fn() },
  auditMock: vi.fn(),
}));

// The real guard's bodySchema check is not what these tests are about — the
// handler receives the raw JSON so the authorization gate can be exercised
// against both an admin and a plain `user:manage` holder.
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: async (
    request: Request,
    _options: unknown,
    handler: (ctx: { session: unknown; body: unknown }) => Promise<Response>,
  ) => {
    const body = await request.clone().json().catch(() => undefined);
    try {
      return await handler({
        session: {
          userId: "u_1",
          username: "someone",
          roles: guardMock.roles,
          mustChangePassword: false,
          currentTeamId: "team_1",
        },
        body,
      });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      return new Response(JSON.stringify({ error: (error as Error).message }), { status });
    }
  },
}));
vi.mock("@/lib/system/import-service", () => importMock);
vi.mock("@/lib/audit/service", () => ({ auditUserAction: auditMock }));

import { POST } from "../route";

function importRequest(body: unknown) {
  return new Request("http://local/api/system/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FILE = { schemaVersion: 1, sourceDomain: "other.example.com", tables: {} };

describe("POST /api/system/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardMock.roles = ["admin"];
    importMock.previewImport.mockResolvedValue({ totalRecords: 3 });
    importMock.executeImport.mockResolvedValue({
      created: 1,
      updated: 0,
      skipped: 0,
      errors: [],
    });
  });

  it("lets a platform admin execute an import", async () => {
    const response = await POST(importRequest({ dryRun: false, file: FILE }));
    expect(response.status).toBe(200);
    expect(importMock.executeImport).toHaveBeenCalledOnce();
  });

  it("refuses a caller who holds user:manage without the admin role", async () => {
    // A direct per-user grant can carry user:manage; an import writes the global
    // RBAC catalog and trusts the file's teamId, so it must not be enough.
    guardMock.roles = ["operator"];

    const response = await POST(importRequest({ dryRun: false, file: FILE }));

    expect(response.status).toBe(403);
    expect(importMock.executeImport).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("refuses the dry-run preview for the same caller", async () => {
    guardMock.roles = ["storage_manager"];

    const response = await POST(importRequest({ dryRun: true, file: FILE }));

    expect(response.status).toBe(403);
    expect(importMock.previewImport).not.toHaveBeenCalled();
  });

  it("reports a rolled-back import as a failure rather than success", async () => {
    importMock.executeImport.mockResolvedValue({
      created: 0,
      updated: 0,
      skipped: 0,
      errors: ["Transaction failed: boom"],
      rolledBack: true,
    });

    const response = await POST(importRequest({ dryRun: false, file: FILE }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("IMPORT_ROLLED_BACK");
  });
});
