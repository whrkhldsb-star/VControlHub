import { expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
const s = vi.hoisted(() => ({ commands: [] as string[], storageLookups: vi.fn(async () => []), grantLookups: vi.fn(), serverCount: vi.fn(async () => 2) }));
vi.mock("@/lib/db", () => ({ prisma: {
  syncJob: { findFirst: async () => ({ id: "job", status: "IDLE", syncType: "BACKUP", teamId: "team", createdBy: "admin", sourceServerId: "s1", targetServerId: "s2", sourcePath: "/etc/secret-config", targetPath: "/outside-storage/copied", sourceServer: { id: "s1", host: "source", username: "root", port: 22, sshKey: null }, targetServer: { id: "s2", host: "target", port: 22, username: "root", sshKey: null }, deleteOrphans: false, compress: false }), updateMany: async () => ({ count: 1 }), update: async () => ({}) },
  syncLog: { create: async () => ({ id: "log" }), update: async () => ({}) },
  server: { count: s.serverCount }, storageNode: { findMany: s.storageLookups, findFirst: s.storageLookups }, userStorageAccess: { findMany: s.grantLookups },
} }));
vi.mock("@/lib/ssh/client", () => ({
  buildSshParamsFromServer: async (server: { host: string }) => ({ host: server.host, username: "root", port: 22, password: "fixture" }),
  writeRemoteFile: vi.fn(),
  execRemoteCommand: async ({ command }: { command: string }) => {
    s.commands.push(command);
    if (command.includes("VCH_SYNC_SOURCE=")) return { stdout: "VCH_SYNC_SOURCE=ready\n", stderr: "", exitCode: 0 };
    if (command.includes("VCH_SYNC_TARGET=")) return { stdout: "VCH_SYNC_TARGET=empty\n", stderr: "", exitCode: 0 };
    if (command.startsWith("which rsync")) return { stdout: "/usr/bin/rsync\n", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  },
}));
vi.mock("../service-credentials", () => ({ decryptSyncTargetCredentials: () => ({ password: "fixture" }) }));
const { executeSyncJob } = await import("../service-runtime");
it("refuses existing sync endpoints outside the current file-only actor reach", async () => {
  const actor: SessionPayload = { userId: "file-only", username: "file-only", roles: [], permissions: ["storage:write"], currentTeamId: "team", mustChangePassword: false };
  const result = await executeSyncJob("job", { actor });
  expect(result.ok).toBe(false);
  expect(s.storageLookups).toHaveBeenCalled();
  expect(s.grantLookups).not.toHaveBeenCalled();
  expect(s.commands).toEqual([]);
});
