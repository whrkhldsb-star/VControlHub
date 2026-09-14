import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
const mocks = vi.hoisted(() => ({ find: vi.fn(), list: vi.fn(), upsert: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { fileEntry: { findFirst: mocks.find }, filePreference: { findMany: mocks.list, upsert: mocks.upsert } } }));
vi.mock("@/lib/auth/team-scope", () => ({ teamWhere: (session: SessionPayload) => ({ teamId: session.currentTeamId }) }));
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: mocks.access }));
import { filePreferenceSchema, updateFilePreference, listFilePreferences } from "../preferences";
const session = { userId: "owner", currentTeamId: "team" } as SessionPayload;
beforeEach(() => { vi.resetAllMocks(); mocks.find.mockResolvedValue({ storageNodeId: "node", relativePath: "docs/a" }); mocks.access.mockResolvedValue({ allowed: true }); });
describe("file preferences", () => {
  it("normalizes tags and rejects oversized or control-character labels", () => {
    expect(filePreferenceSchema.parse({ fileEntryId: "file", tags: [" Work ", "Work"] }).tags).toEqual(["Work"]);
    expect(filePreferenceSchema.safeParse({ fileEntryId: "file", tags: ["bad\nlabel"] }).success).toBe(false);
    expect(filePreferenceSchema.safeParse({ fileEntryId: "file", tags: Array.from({ length: 13 }, (_, i) => String(i)) }).success).toBe(false);
  });
  it("scopes lookup by current team and updates only requested fields", async () => {
    await updateFilePreference(session, { fileEntryId: "file", favorite: true });
    expect(mocks.find.mock.calls[0]![0].where.storageNode).toEqual({ teamId: "team" });
    expect(mocks.upsert.mock.calls[0]![0]).toMatchObject({ where: { userId_fileEntryId: { userId: "owner", fileEntryId: "file" } }, update: { favorite: true } });
    expect(mocks.upsert.mock.calls[0]![0].update).not.toHaveProperty("tags");
  });
  it("refuses metadata writes after path permission revocation", async () => {
    mocks.access.mockResolvedValue({ allowed: false });
    await expect(updateFilePreference(session, { fileEntryId: "file", opened: true })).rejects.toThrow("access denied");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("filters inaccessible saved files without disclosing their metadata", async () => {
    mocks.list.mockResolvedValue([{ fileEntryId: "public", fileEntry: { storageNodeId: "node", relativePath: "public" } }, { fileEntryId: "private", fileEntry: { storageNodeId: "node", relativePath: "private" } }]);
    mocks.access.mockImplementation(async ({ relativePath }) => ({ allowed: relativePath === "public" }));
    const result = await listFilePreferences(session, { mode: "favorites" });
    expect(result.items.map((item) => item.fileEntryId)).toEqual(["public"]);
    expect(mocks.list.mock.calls[0]![0].where).toMatchObject({ userId: "owner", favorite: true, fileEntry: { isDeleted: false, storageNode: { teamId: "team" } } });
  });
});
