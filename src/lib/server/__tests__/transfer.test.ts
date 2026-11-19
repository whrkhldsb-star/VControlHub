/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionPayload } from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
  serverFindUnique: vi.fn(),
  teamFindUnique: vi.fn(),
  imageUploadCount: vi.fn(),
  commandTargetCount: vi.fn(),
  downloadTaskCount: vi.fn(),
  transaction: vi.fn(),
  serverUpdate: vi.fn((args: unknown) => ({ op: "server.update", args })),
  storageNodeUpdateMany: vi.fn((args: unknown) => ({ op: "storageNode.updateMany", args })),
  metricSnapshotUpdateMany: vi.fn((args: unknown) => ({ op: "metricSnapshot.updateMany", args })),
  userServerAccessDeleteMany: vi.fn((args: unknown) => ({ op: "userServerAccess.deleteMany", args })),
  userStorageAccessDeleteMany: vi.fn((args: unknown) => ({ op: "userStorageAccess.deleteMany", args })),
  rdpTicketDeleteMany: vi.fn((args: unknown) => ({ op: "rdpTicket.deleteMany", args })),
  vpsBackupScheduleUpdateMany: vi.fn((args: unknown) => ({ op: "vpsBackupSchedule.updateMany", args })),
  vpsBackupRecordUpdateMany: vi.fn((args: unknown) => ({ op: "vpsBackupRecord.updateMany", args })),
  impact: vi.fn(),
  bindings: vi.fn(),
  revoke: vi.fn(),
  rebind: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: { findUnique: mocks.serverFindUnique, update: mocks.serverUpdate },
    team: { findUnique: mocks.teamFindUnique },
    imageUpload: { count: mocks.imageUploadCount },
    commandTarget: { count: mocks.commandTargetCount },
    downloadTask: { count: mocks.downloadTaskCount },
    agentFileShare: { deleteMany: mocks.revoke, createMany: mocks.rebind },
    storageNode: { findFirst: vi.fn(async () => null), updateMany: mocks.storageNodeUpdateMany },
    metricSnapshot: { updateMany: mocks.metricSnapshotUpdateMany },
    userServerAccess: { deleteMany: mocks.userServerAccessDeleteMany },
    userStorageAccess: { deleteMany: mocks.userStorageAccessDeleteMany },
    rdpTicket: { deleteMany: mocks.rdpTicketDeleteMany },
    vpsBackupSchedule: { updateMany: mocks.vpsBackupScheduleUpdateMany },
    vpsBackupRecord: { updateMany: mocks.vpsBackupRecordUpdateMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: vi.fn(async () => async () => undefined) }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.audit }));
vi.mock("@/lib/i18n/service-translations", () => ({
  t: (key: string, vars?: Record<string, string>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
}));
vi.mock("../service-deletion-impact", () => ({ getServerDeletionImpact: mocks.impact, listServerStorageNodes: mocks.bindings }));

const { transferServerToCustomer } = await import("../transfer");

const ADMIN = { userId: "u_admin", roles: ["admin"], currentTeamId: null } as unknown as SessionPayload;
const CUSTOMER = { userId: "u_cust", roles: [], currentTeamId: "team_a" } as unknown as SessionPayload;
const NO_IMPACT = { shares: 0, scheduledTasks: 0, alertRules: 0, playbooks: 0, syncJobs: 0 };

describe("transferServerToCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverFindUnique.mockResolvedValue({ id: "srv_1", name: "web", teamId: "team_a", storageNode: { id: "node_1" } });
    mocks.teamFindUnique.mockResolvedValue({ id: "team_b", name: "Beta", deletedAt: null });
    mocks.impact.mockResolvedValue(NO_IMPACT);
    mocks.imageUploadCount.mockResolvedValue(0);
    mocks.commandTargetCount.mockResolvedValue(0);
    mocks.downloadTaskCount.mockResolvedValue(0);
    mocks.bindings.mockResolvedValue([{ id: "node_1", driver: "SFTP", teamId: "team_a" }, { id: "agent_disk", driver: "AGENT", teamId: "team_a" }]);
    mocks.transaction.mockImplementation(async run => run((await import("@/lib/db")).prisma));
  });

  it("is reserved for platform administrators", async () => {
    await expect(transferServerToCustomer("srv_1", "team_b", CUSTOMER)).rejects.toThrow("backend.customer.platformOnly");
    expect(mocks.serverUpdate).not.toHaveBeenCalled();
  });

  it("moves the server with its storage and history and drops the old customer's grants", async () => {
    await expect(transferServerToCustomer("srv_1", "team_b", ADMIN)).resolves.toEqual({ serverId: "srv_1", teamId: "team_b", teamName: "Beta" });
    expect(mocks.storageNodeUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["node_1", "agent_disk"] } }, data: { teamId: "team_b" } });
    expect(mocks.revoke).toHaveBeenCalledWith({ where: { serverId: "srv_1", storageNodeId: { in: ["agent_disk"] } } });
    expect(mocks.revoke).toHaveBeenCalledBefore(mocks.rebind);
    expect(mocks.rebind).toHaveBeenCalledWith({ data: [{ serverId: "srv_1", storageNodeId: "agent_disk", teamId: "team_b" }] });
    // Backup ownership follows the transfer (A2-03): the old customer's creator can no longer run them.
    expect(mocks.vpsBackupScheduleUpdateMany).toHaveBeenCalledWith({ where: { serverId: "srv_1" }, data: { createdById: "u_admin" } });
    expect(mocks.serverUpdate).toHaveBeenCalledWith({ where: { id: "srv_1" }, data: { teamId: "team_b" } });
    expect(mocks.userStorageAccessDeleteMany).toHaveBeenCalledWith({ where: { storageNodeId: { in: ["node_1", "agent_disk"] } } });
    expect(mocks.audit).toHaveBeenCalledWith("u_admin", "server.transfer", expect.objectContaining({ fromTeamId: "team_a", toTeamId: "team_b" }), undefined, "team_b");
  });

  it("refuses while the previous customer still uses the server", async () => {
    mocks.impact.mockResolvedValue({ ...NO_IMPACT, shares: 2, unfinishedCommands: 1 });
    await expect(transferServerToCustomer("srv_1", "team_b", ADMIN)).rejects.toThrow(/backend\.server\.transfer\.blocked/);
    expect(mocks.serverUpdate).not.toHaveBeenCalled();
  });

  it("rejects a deleted target customer and a no-op move", async () => {
    mocks.teamFindUnique.mockResolvedValueOnce({ id: "team_b", name: "Beta", deletedAt: new Date() });
    await expect(transferServerToCustomer("srv_1", "team_b", ADMIN)).rejects.toThrow("backend.customer.notFound");
    await expect(transferServerToCustomer("srv_1", "team_a", ADMIN)).rejects.toThrow("backend.server.transfer.sameCustomer");
    expect(mocks.serverUpdate).not.toHaveBeenCalled();
  });
});
