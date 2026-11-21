// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { openOrRefreshAlertIncident } from "../incidents";
import { createAlertRule, ensureDefaultAlertRules, toggleAlertRule, updateAlertRule } from "../service";
import { verifiedRuleChannels } from "../channel-grants";

const { failEnqueue } = vi.hoisted(() => ({ failEnqueue: { once: false } }));
vi.mock("@/lib/job/service", async (original) => {
  const service = await original<typeof import("@/lib/job/service")>();
  return {
    ...service,
    enqueueJob: async (...args: Parameters<typeof service.enqueueJob>) => {
      const job = await service.enqueueJob(...args);
      if (failEnqueue.once) { failEnqueue.once = false; throw new Error("injected after enqueue"); }
      return job;
    },
  };
});

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("alert transactions and platform-channel grants (PostgreSQL)", () => {
  const prefix = "alert-tx-" + randomUUID();
  const teamId = prefix + "-customer";
  const defaultsTeam = prefix + "-defaults";
  const playbookId = prefix + "-book";
  const serverId = prefix + "-server";
  const ruleId = prefix + "-rule";
  const owner = prefix + "-owner";
  const admin = { userId: owner, roles: ["admin" as const], currentTeamId: teamId };
  const customer = { ...admin, userId: prefix + "-operator", roles: ["operator" as const] };
  const marker = "alerts.defaultRulesSeeded:" + defaultsTeam;
  const collision = "starter-" + createHash("sha256").update(JSON.stringify([defaultsTeam, "mem_usage"])).digest("hex");
  const config = { name: prefix, metric: "cpu_usage", threshold: 90, operator: "gte" };

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) throw new Error("requires an isolated test database");
    await prisma.team.createMany({ data: [teamId, defaultsTeam].map((id) => ({ id, slug: id, name: id })) });
    await prisma.user.create({ data: { id: owner, username: owner, passwordHash: "unused" } });
    await prisma.server.create({ data: { id: serverId, teamId, name: serverId, host: "fixture.test", username: "test" } });
    await prisma.playbook.create({ data: {
      id: playbookId, name: playbookId, teamId, createdById: owner, triggerType: "metric", triggerConfig: {}, chainRetry: 2,
      steps: [{ id: "notify", name: "notify", type: "send_notification", config: { recipientUserId: owner, subject: "alert", body: "alert" } }],
    } });
    await prisma.alertRule.create({ data: { ...config, id: ruleId, teamId, playbookIds: [playbookId, playbookId] } });
  });
  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { OR: [{ key: marker }, { updatedBy: owner }] } });
    await prisma.alertRule.deleteMany({ where: { OR: [{ teamId: { in: [teamId, defaultsTeam] } }, { id: collision }] } });
    await prisma.playbook.deleteMany({ where: { id: playbookId } });
    await prisma.job.deleteMany({ where: { teamId } });
    await prisma.server.deleteMany({ where: { id: serverId } });
    await prisma.user.deleteMany({ where: { id: owner } });
    await prisma.team.deleteMany({ where: { id: { in: [teamId, defaultsTeam] } } });
    await prisma.$disconnect();
  });

  it("rolls back the opening and job together, then queues once per binding and opening under concurrent retries", async () => {
    const fire = () => openOrRefreshAlertIncident({
      ...config, ruleId, ruleName: config.name, serverId, serverName: serverId, teamId,
      value: 95, title: "CPU high", message: "CPU high", notifyChannels: [], playbookIds: [playbookId, playbookId],
    });
    failEnqueue.once = true;
    await expect(fire()).rejects.toThrow("injected after enqueue");
    expect(await prisma.alertIncident.count({ where: { ruleId } })).toBe(0);
    expect(await prisma.playbookRun.count({ where: { playbookId } })).toBe(0);
    expect(await prisma.job.count({ where: { teamId } })).toBe(0);

    const first = await Promise.all([fire(), fire()]);
    expect(first.filter((result) => result.fired)).toHaveLength(1);
    await prisma.alertIncident.updateMany({ where: { ruleId }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    const reopened = await Promise.all([fire(), fire()]);
    expect(reopened.filter((result) => result.fired)).toHaveLength(1);
    const runs = await prisma.playbookRun.findMany({ where: { playbookId } });
    expect(runs).toHaveLength(2);
    expect(new Set(runs.map((run) => run.triggerKey)).size).toBe(2);
    for (const run of runs) {
      expect(run.executionState).toMatchObject({ schemaVersion: 2, actorId: owner, chainRetry: 2, sourceRuleTeamId: teamId });
      expect(await prisma.job.findUniqueOrThrow({ where: { id: run.jobId! } })).toMatchObject({ maxAttempts: 3, createdBy: owner });
    }
  });

  it("keeps no partial starter pack or marker on failure and installs exactly one pack on concurrent retry", async () => {
    // A real unique-key conflict on the third insert interrupts the transaction.
    await prisma.alertRule.create({ data: { ...config, id: collision } });
    const seed = () => ensureDefaultAlertRules({ ...customer, currentTeamId: defaultsTeam });
    await expect(seed()).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.alertRule.count({ where: { teamId: defaultsTeam } })).toBe(0);
    expect(await prisma.setting.findUnique({ where: { key: marker } })).toBeNull();
    await prisma.alertRule.delete({ where: { id: collision } });
    expect((await Promise.all([seed(), seed(), seed()])).map((x) => x.created).sort()).toEqual([0, 0, 4]);
    expect(await prisma.alertRule.count({ where: { teamId: defaultsTeam } })).toBe(4);
    expect(await prisma.setting.findUnique({ where: { key: marker } })).toMatchObject({ value: "true" });
  });

  it("requires approval of the effective platform channels and invalidates a changed or imported configuration", async () => {
    const channels = ["in_app", "email", "telegram"];
    const rule = await createAlertRule({ ...config, notifyChannels: channels }, admin);
    expect(await verifiedRuleChannels(rule)).toEqual(channels);
    expect(await prisma.setting.findUnique({ where: { key: "alerts.platformChannels." + rule.id } })).toMatchObject({ updatedBy: owner });
    await expect(updateAlertRule(rule.id, { name: "unapproved" }, customer)).rejects.toMatchObject({ status: 400 });
    await updateAlertRule(rule.id, { enabled: false }, customer);
    await expect(toggleAlertRule(rule.id, customer)).rejects.toMatchObject({ status: 400 });
    const imported = await prisma.alertRule.update({ where: { id: rule.id }, data: { enabled: true, name: "imported" } });
    expect(await verifiedRuleChannels(imported)).toEqual(["in_app"]);
    const approved = await updateAlertRule(rule.id, { name: "reviewed" }, admin);
    expect(await verifiedRuleChannels(approved)).toEqual(channels);
  });
});
