// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as getRules } from "@/app/api/alert-rules/route";
import { GET as getPlaybooks } from "@/app/api/playbooks/route";
import * as permissions from "@/lib/auth/require-api-permission";
import { acquireAdvisoryLock, getLockKeys } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import type { TeamSession } from "@/lib/auth/team-scope";
import { updateAlertRule } from "@/lib/alert/service";
import { deletePlaybook, getPlaybook, getPlaybookRun, listPlaybooks, listRecentPlaybookRunsForPlaybooks, reconcileTerminalPlaybookJobs, updatePlaybook } from "../service";
import { canReceivePlaybookNotification } from "../notification-recipient";
import { projectPlaybookAuditEntry, projectPlaybookJobMessage, redactLegacyPlaybookMessages } from "../legacy-messages";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("playbook customer lifecycle (PostgreSQL)", () => {
  const id = `pbl-${randomUUID()}`;
  const other = id + "-other";
  const ruleId = id + "-rule";
  const where = { id };
  const config = { metric: "cpu_usage", operator: "gt", threshold: 80 } as const;
  const command = { id: "one", name: "check", type: "run_command", retry: 0, timeoutSec: 10,
    config: { command: "echo example", variables: { arg: "private" }, serverIds: [id] } };
  const admin: TeamSession = { userId: id, roles: ["admin"], currentTeamId: null };
  const reader: TeamSession = { userId: id, roles: [], currentTeamId: id, permissions: ["playbook:read"] };
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) throw new Error("requires an isolated loopback test database");
    await prisma.team.createMany({ data: [id, other].map((key) => ({ id: key, name: key, slug: key })) });
    await prisma.user.create({ data: { id, username: id, passwordHash: "test", status: "ACTIVE", mustChangePassword: false } });
    await prisma.identityTemplate.create({ data: { id, name: id, permissions: ["playbook:run"] } });
    await prisma.teamMember.create({ data: { userId: id, teamId: id, identityTemplateId: id } });
    await prisma.playbook.create({ data: { id, name: id, teamId: id, createdById: id, triggerType: "metric", triggerConfig: config, steps: [command], enabled: false } });
    await prisma.alertRule.create({ data: { id: ruleId, name: ruleId, teamId: id, metric: "cpu_usage", operator: "gt", threshold: 80 } });
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: id }, { id }] } });
    await prisma.alertRule.deleteMany({ where: { id: ruleId } });
    await prisma.playbook.deleteMany({ where });
    await prisma.job.deleteMany({ where: { id: { startsWith: id } } });
    await prisma.user.deleteMany({ where });
    await prisma.identityTemplate.deleteMany({ where });
    await prisma.team.deleteMany({ where: { id: { in: [id, other] } } });
    await prisma.$disconnect();
  });

  it("redacts command targets, variables and text, and reflects changes to the owner's execution authority", async () => {
    expect(await canReceivePlaybookNotification(id, null)).toBe(false);
    expect(await canReceivePlaybookNotification(id, id)).toBe(true);
    expect(await getPlaybook(id, reader)).toMatchObject({ ownerActive: true, steps: [{ config: {} }] });
    expect((await listPlaybooks(reader)).find((p) => p.id === id)?.steps[0]?.config).toEqual({});
    for (const permission of ["command:execute", "command:approve"] as const) {
      expect((await getPlaybook(id, { ...reader, permissions: [permission] }))?.steps[0]?.config).toEqual(command.config);
    }
    const run = await prisma.playbookRun.create({ data: {
      playbookId: id, teamId: id, status: "completed", dryRun: true, executionState: { schemaVersion: 1, stepsSnapshot: [command] },
      stepResults: [{ stepId: "one", status: "dry_run", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), summary: "echo example", commandRequestId: "private-request" }],
    } });
    try {
      const hidden = (await getPlaybookRun(run.id, reader))?.stepResults;
      expect(hidden?.[0]?.summary).toBe("dry_run");
      expect(hidden?.[0]).not.toHaveProperty("commandRequestId");
      expect((await getPlaybookRun(run.id, { ...reader, permissions: ["command:approve"] }))?.stepResults[0]?.summary).toBe("echo example");
    } finally { await prisma.playbookRun.delete({ where: { id: run.id } }); }
    await prisma.identityTemplate.update({ where, data: { permissions: [] } });
    expect((await getPlaybook(id, reader))?.ownerActive).toBe(false);
    expect((await listPlaybooks(reader)).find((p) => p.id === id)?.ownerActive).toBe(false);
    await prisma.identityTemplate.update({ where, data: { permissions: ["playbook:run"] } });
  });

  it("preserves metric crossings on an equivalent PATCH and ranks only this customer's runs", async () => {
    const state = { [id]: { breached: true, sampleAt: new Date().toISOString(), value: 90 } };
    await prisma.playbook.update({ where, data: { metricMatchState: state } });
    await updatePlaybook({ id, triggerType: "metric", triggerConfig: { threshold: 80, metric: "cpu_usage", operator: "gt" } }, id, admin);
    expect((await prisma.playbook.findUniqueOrThrow({ where })).metricMatchState).toEqual(state);
    expect(await prisma.auditLog.findFirst({ where: { actorId: id, action: "playbook.update" } })).toMatchObject({ teamId: id });
    const own = await prisma.playbookRun.create({ data: { playbookId: id, teamId: id, status: "completed", createdAt: new Date(0) } });
    await prisma.playbookRun.createMany({ data: Array.from({ length: 6 }, () => ({ playbookId: id, teamId: other, status: "completed" as const })) });
    expect((await listRecentPlaybookRunsForPlaybooks([id], reader))[id]!.map((r) => r.id)).toEqual([own.id]);
  });

  it("hides and protects archived playbooks in the all-customers view", async () => {
    await prisma.team.update({ where, data: { deletedAt: new Date() } });
    try {
      expect((await listPlaybooks(admin)).some((p) => p.id === id)).toBe(false);
      await expect(deletePlaybook(id, id, admin)).rejects.toMatchObject({ status: 404 });
      expect(await prisma.playbook.count({ where })).toBe(1);
    } finally { await prisma.team.update({ where, data: { deletedAt: null } }); }
  });

  it("continues past 200 rules and 500 playbooks when a previous page's cursor row is deleted", async () => {
    const rows = Array.from({ length: 501 }, (_, n) => ({
      id: other + "-" + String(n).padStart(3, "0"), name: "page", teamId: other, enabled: false,
    }));
    const guard = vi.spyOn(permissions, "requireApiPermission").mockResolvedValue({
      session: { userId: id, roles: [], username: id, mustChangePassword: false, currentTeamId: other, permissions: ["playbook:read", "notification:manage"] },
    });
    try {
      await prisma.playbook.createMany({ data: rows.map((row) => ({ ...row, triggerType: "metric", triggerConfig: config, steps: [] })) });
      await prisma.alertRule.createMany({ data: rows.slice(0, 201).map((row) => ({ ...row, ...config })) });
      const rules = "http://localhost/api/alert-rules";
      const books = "http://localhost/api/playbooks";
      const rulePage = await (await getRules(new Request(rules))).json();
      const bookPage = await (await getPlaybooks(new Request(books))).json();
      expect(rulePage.rules).toHaveLength(200);
      expect(bookPage.playbooks).toHaveLength(500);
      expect(rulePage.nextCursor).toBe(rows[1]!.id);
      expect(bookPage.nextCursor).toBe(rows[1]!.id);
      await prisma.alertRule.delete({ where: { id: rulePage.nextCursor } });
      await prisma.playbook.delete({ where: { id: bookPage.nextCursor } });
      expect(await (await getRules(new Request(rules + "?after=" + rulePage.nextCursor))).json()).toMatchObject({ rules: [{ id: rows[0]!.id }], nextCursor: null });
      expect(await (await getPlaybooks(new Request(books + "?after=" + bookPage.nextCursor))).json()).toMatchObject({ playbooks: [{ id: rows[0]!.id }], nextCursor: null });
    } finally {
      guard.mockRestore();
      await prisma.alertRule.deleteMany({ where: { teamId: other } });
      await prisma.playbook.deleteMany({ where: { teamId: other } });
      await prisma.setting.deleteMany({ where: { key: "alerts.defaultRulesSeeded:" + other } });
    }
  });

  it("checks the definition after acquiring the same lock as an editor", async () => {
    await prisma.playbook.update({ where, data: { triggerType: "manual", steps: [], enabled: true } });
    const editor = await acquireAdvisoryLock("playbook-lifecycle", id);
    const session: TeamSession = { ...reader, permissions: ["playbook:run", "notification:manage"] };
    const result = updateAlertRule(ruleId, { playbookIds: [id] }, session);
    const rejected = expect(result).rejects.toMatchObject({ status: 403 });
    try {
      // Wait until the binding writer is actually waiting in the database.
      const { k1, k2 } = getLockKeys("playbook-lifecycle", id);
      await expect.poll(async () => (await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted AND classid::bigint = ${k1 >>> 0} AND objid::bigint = ${k2 >>> 0}`)[0]?.count).toBeGreaterThan(0);
      await prisma.playbook.update({ where, data: { steps: [command] } });
    } finally { await editor(); }
    await rejected;
    expect((await prisma.alertRule.findUniqueOrThrow({ where: { id: ruleId } })).playbookIds).toEqual([]);
  });

  it("reconciles terminal jobs and scrubs retained webhook errors and heartbeat text idempotently", async () => {
    const message = "webhook POST https://example.test/private?token=fixture returned 503";
    await prisma.job.create({ data: { id, title: "Playbook run", type: "playbook.run", payload: {}, status: "FAILED", progress: message } });
    await prisma.jobEvent.create({ data: { id, jobId: id, type: "heartbeat", message } });
    const audit = await prisma.auditLog.create({ data: { id, actorType: "SYSTEM", action: "playbook.run.failed", detail: { failedError: message, stepCount: 1 } } });
    expect(projectPlaybookAuditEntry(audit).detail).toEqual({ failedError: "Webhook delivery failed", stepCount: 1 });
    expect(projectPlaybookJobMessage("playbook.run", "heartbeat", message)).toBe("Playbook step progress");
    expect(projectPlaybookJobMessage("other", "heartbeat", message)).toBe(message);
    await prisma.playbookRun.create({ data: { id, playbookId: id, jobId: id, status: "running" } });
    expect(await reconcileTerminalPlaybookJobs(prisma, { jobId: id })).toBe(1);
    expect(await reconcileTerminalPlaybookJobs(prisma, { jobId: id })).toBe(0);
    expect(await prisma.playbookRun.findUniqueOrThrow({ where })).toMatchObject({ status: "failed", completedAt: expect.any(Date) });
    await redactLegacyPlaybookMessages();
    expect((await prisma.auditLog.findUniqueOrThrow({ where })).detail).toEqual({ failedError: "Webhook delivery failed", stepCount: 1 });
    expect((await prisma.job.findUniqueOrThrow({ where })).progress).not.toContain("private");
    expect((await prisma.jobEvent.findUniqueOrThrow({ where })).message).not.toContain("private");
  });
});
