import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock, findFirstMock, createMock, sessionHasPermissionMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findFirstMock: vi.fn(),
  createMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(() => false),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    itsmConnection: {
      findMany: findManyMock,
      findFirst: findFirstMock,
      create: createMock,
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    itsmEvent: {
      findMany: vi.fn(async () => []),
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));

vi.mock("@/lib/crypto/service", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ""),
  isEncrypted: (v: string) => typeof v === "string" && v.startsWith("enc:"),
}));

import { createItsmConnection, getItsmConnection, listItsmConnections } from "../service";

describe("ITSM team scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionHasPermissionMock.mockReturnValue(false);
  });

  it("listItsmConnections spreads teamWhere for non-admin session", async () => {
    findManyMock.mockResolvedValueOnce([]);
    await listItsmConnections({
      userId: "u1",
      roles: ["operator"],
      currentTeamId: "team_a",
    });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ teamId: "team_a" }, { teamId: null }],
        }),
      }),
    );
  });

  it("getItsmConnection scopes by team", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    await expect(
      getItsmConnection("c1", {
        userId: "u1",
        roles: ["operator"],
        currentTeamId: "team_a",
      }),
    ).rejects.toThrow(/not found/i);
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "c1",
          OR: [{ teamId: "team_a" }, { teamId: null }],
        }),
      }),
    );
  });

  it("createItsmConnection assigns currentTeamId when body omits teamId", async () => {
    createMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "c_new",
      lastOutboundAt: null,
      lastInboundAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      credentialsEnc: data.credentialsEnc ?? "",
      config: data.config ?? {},
      enabled: true,
      direction: "bidirectional",
      ...data,
    }));
    const row = await createItsmConnection(
      {
        name: "Slack ops",
        provider: "slack",
        config: { webhookUrl: "https://hooks.example.com/x" },
        credentials: { webhookSecret: "s" },
      },
      { userId: "u1", roles: ["operator"], currentTeamId: "team_a" },
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teamId: "team_a", createdById: "u1" }),
      }),
    );
    expect(row.teamId).toBe("team_a");
  });
});
