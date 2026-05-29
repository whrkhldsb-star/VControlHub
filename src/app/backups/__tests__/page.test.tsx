import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: vi.fn().mockResolvedValue({
    userId: "u1",
    username: "admin",
    roles: ["admin"],
    permissions: ["backup:read", "backup:create", "backup:restore"],
    mustChangePassword: false,
  }),
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: vi.fn((_session, permission: string) => ["backup:read", "backup:create", "backup:restore"].includes(permission)),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/backup/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backup/service")>("@/lib/backup/service");
  return {
    ...actual,
    listBackupRecords: vi.fn().mockResolvedValue([
      {
        id: "bak-db",
        type: "DATABASE",
        status: "PENDING",
        filePath: "backups/database.sql.gz",
        createdAt: new Date("2026-05-29T00:00:00.000Z"),
        fileSize: null,
        completedAt: null,
        errorMessage: null,
        note: null,
        creator: { username: "admin", displayName: "Admin" },
      },
      {
        id: "bak-files",
        type: "FILES",
        status: "PENDING",
        filePath: "backups/files.tar.gz",
        createdAt: new Date("2026-05-29T00:00:00.000Z"),
        fileSize: null,
        completedAt: null,
        errorMessage: null,
        note: null,
        creator: { username: "admin", displayName: "Admin" },
      },
      {
        id: "bak-full",
        type: "FULL",
        status: "PENDING",
        filePath: "backups/full.tar.gz",
        createdAt: new Date("2026-05-29T00:00:00.000Z"),
        fileSize: null,
        completedAt: null,
        errorMessage: null,
        note: null,
        creator: { username: "admin", displayName: "Admin" },
      },
    ]),
  };
});

import BackupsPage from "../page";

describe("BackupsPage", () => {
  it("shows backup commands that match each recorded backup type", async () => {
    render(await BackupsPage());

    expect(screen.getByText(/deploy\/backup\.sh 'backups\/database\.sql\.gz'/)).toBeInTheDocument();
    expect(screen.getByText(/deploy\/backup\.sh --files 'backups\/files\.tar\.gz'/)).toBeInTheDocument();
    expect(screen.getByText(/deploy\/backup\.sh --full 'backups\/full\.tar\.gz'/)).toBeInTheDocument();
    expect(screen.getByText(/restore-db\.sh 'backups\/database\.sql\.gz'/)).toBeInTheDocument();
    expect(screen.getByText(/tar -xzf 'backups\/files\.tar\.gz'/)).toBeInTheDocument();
    expect(screen.getByText(/tar -xzf 'backups\/full\.tar\.gz'/)).toBeInTheDocument();
  });
});
