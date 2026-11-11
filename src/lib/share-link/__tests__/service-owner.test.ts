/** @vitest-environment node */
/**
 * Who a share belongs to. Runs against the real customer scoping
 * (`@/lib/auth/team-scope`): service.test.ts replaces it with a lenient
 * stand-in, which is how sharing stayed broken for an administrator viewing
 * all customers without a test noticing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    shareLink: { create: vi.fn() },
    storageNode: { findUnique: vi.fn() },
    fileEntry: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: vi.fn(async () => ({ allowed: true })),
  releaseStorageQuotaGuard: vi.fn(async () => undefined),
}));

const { createShareLink, createShareLinkFromFileEntry } = await import("../service");

const administrator = (currentTeamId: string | null) => ({ userId: "admin_1", username: "root", roles: ["admin" as const], mustChangePassword: false, currentTeamId });
const customerAccount = { userId: "u_1", username: "alice", roles: ["operator" as const], mustChangePassword: false, currentTeamId: "team_a" };

function nodeOf(teamId: string | null) {
  mockPrisma.storageNode.findUnique.mockResolvedValue({ teamId });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.shareLink.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "share_1", ...data, createdAt: new Date(), updatedAt: new Date() }));
});

describe("the customer a share belongs to", () => {
  // The share took the customer selected in the session and refused without one ("Select a customer in
  // the sidebar first"). An administrator viewing all customers has none selected, so neither the share
  // action of the files page nor the picker of the Shares page could create a link.
  it("is the storage node's, for an administrator viewing all customers", async () => {
    nodeOf("team_a");

    const result = await createShareLink({ session: administrator(null), storageNodeId: "node_1", path: "docs/report.pdf" });

    expect(result.token).toHaveLength(48);
    expect(mockPrisma.storageNode.findUnique).toHaveBeenCalledWith({ where: { id: "node_1" }, select: { teamId: true } });
    expect(mockPrisma.shareLink.create.mock.calls[0]![0].data).toMatchObject({ storageNodeId: "node_1", path: "docs/report.pdf", teamId: "team_a", createdBy: "admin_1" });
  });

  // Only that view can open a node that belongs to no customer, and it is documented as able to share from it.
  it("is nobody's for a node that belongs to no customer", async () => {
    nodeOf(null);

    await createShareLink({ session: administrator(null), storageNodeId: "node_legacy", path: "a.txt" });

    expect(mockPrisma.shareLink.create.mock.calls[0]![0].data.teamId).toBeNull();
  });

  it.each([
    ["an administrator working as that customer", administrator("team_a")],
    ["one of the customer's accounts", customerAccount],
  ])("is the node's as before for %s", async (_who, session) => {
    nodeOf("team_a");

    await createShareLink({ session, storageNodeId: "node_1", path: "a.txt" });

    expect(mockPrisma.shareLink.create.mock.calls[0]![0].data.teamId).toBe("team_a");
  });

  it("is found the same way when sharing an indexed file", async () => {
    mockPrisma.fileEntry.findFirst.mockResolvedValue({ id: "file_1", name: "report.pdf", relativePath: "docs/report.pdf", entryType: "FILE", storageNodeId: "node_1" });
    nodeOf("team_b");

    const result = await createShareLinkFromFileEntry({ session: administrator(null), fileEntryId: "file_1", expiresInHours: 24 });

    expect(result.share).toMatchObject({ teamId: "team_b", name: "report.pdf", path: "docs/report.pdf" });
    // All customers: the file is looked up without narrowing to one.
    expect(mockPrisma.fileEntry.findFirst.mock.calls[0]![0].where).toMatchObject({ id: "file_1", isDeleted: false, storageNode: {} });
  });

  it("answers not found when the node went away after the access check", async () => {
    mockPrisma.storageNode.findUnique.mockResolvedValue(null);

    await expect(createShareLink({ session: administrator(null), storageNodeId: "node_gone", path: "a.txt" })).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.shareLink.create).not.toHaveBeenCalled();
  });
});
