import { beforeEach, describe, expect, it, vi } from "vitest";

const { commandTemplateFindFirst, serverFindMany } = vi.hoisted(() => ({
  commandTemplateFindFirst: vi.fn(),
  serverFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    commandTemplate: { findFirst: commandTemplateFindFirst },
    server: { findMany: serverFindMany },
  },
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: (session: { roles: string[] }, permission: string) =>
    permission !== "command:approve" || session.roles.includes("admin"),
}));

vi.mock("@/lib/command/service", () => ({ createCommandRequest: vi.fn() }));
vi.mock("@/lib/scheduled-task/service", () => ({ createScheduledTask: vi.fn() }));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: vi.fn() }));

const { materializeAutomationProposal } = await import("../automation-service");

describe("generic AI automation proposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commandTemplateFindFirst.mockResolvedValue({
      id: "template_key",
      name: "Install SSH public key",
      command: "install-key '{{public_key}}'",
      rollbackCommand: "remove-key '{{public_key}}'",
	  variables: ["public_key"],
	  isBuiltin: true,
    });
    serverFindMany.mockResolvedValue([
      { id: "srv_1", name: "A", host: "10.0.0.1", teamId: "team_1" },
      { id: "srv_2", name: "B", host: "10.0.0.2", teamId: "team_1" },
    ]);
  });

  it("renders a reviewed template and expands all visible targets", async () => {
    const proposal = await materializeAutomationProposal({
      name: "Install key fleet-wide",
      plan: "Add the key and verify login before removing old access.",
      reason: "Access rotation",
      executionMode: "daily",
      dailyTime: "03:30",
      targetScope: "all",
      templateId: "template_key",
      variables: { public_key: "ssh-ed25519 AAAA test" },
      approvalMode: "every_run",
    }, { userId: "u1", roles: ["operator"], currentTeamId: "team_1" });

    expect(proposal.command).toBe("install-key 'ssh-ed25519 AAAA test'");
    expect(proposal.rollbackCommand).toBe("remove-key 'ssh-ed25519 AAAA test'");
    expect(proposal.serverIds).toEqual(["srv_1", "srv_2"]);
    expect(proposal.approvalRequired).toBe(true);
  });

  it("requires command approval permission for unattended runs", async () => {
    await expect(materializeAutomationProposal({
      name: "Unattended update",
      plan: "Update packages.",
      reason: "Maintenance",
      executionMode: "now",
      targetScope: "selected",
      serverIds: ["srv_1"],
      command: "apt update",
      approvalMode: "approve_once",
    }, { userId: "u1", roles: ["operator"], currentTeamId: "team_1" })).rejects.toThrow(/command:approve/);
  });

  it("accepts a previously normalized proposal with nullable optional fields", async () => {
    serverFindMany.mockResolvedValue([
      { id: "srv_1", name: "A", host: "10.0.0.1", teamId: "team_1" },
    ]);
    const proposal = await materializeAutomationProposal({
      name: "Read-only probe",
      plan: "Run a read-only connectivity check.",
      reason: "Verification",
      executionMode: "now",
      targetScope: "selected",
      serverIds: ["srv_1"],
      command: "uptime",
      templateId: null,
      templateName: null,
      verificationCommand: null,
      rollbackCommand: null,
      approvalMode: "approve_once",
    }, { userId: "u1", roles: ["admin"], currentTeamId: "team_1" });

    await expect(materializeAutomationProposal(proposal, {
      userId: "u1",
      roles: ["admin"],
      currentTeamId: "team_1",
    })).resolves.toMatchObject({ command: "uptime", templateId: null, rollbackCommand: null });
  });

  it("rejects multiline or shell-injected public keys before approval", async () => {
	serverFindMany.mockResolvedValueOnce([
		{ id: "srv_1", name: "A", host: "10.0.0.1", teamId: "team_1" },
	]);
    await expect(materializeAutomationProposal({
      name: "Install key",
      plan: "Install one key.",
      reason: "Access",
      executionMode: "now",
      targetScope: "selected",
      serverIds: ["srv_1"],
      templateId: "template_key",
      variables: { public_key: "ssh-ed25519 AAAA ok\nrm -rf /" },
      approvalMode: "every_run",
    }, { userId: "u1", roles: ["operator"], currentTeamId: "team_1" })).rejects.toThrow(/public_key/);
  });
});
