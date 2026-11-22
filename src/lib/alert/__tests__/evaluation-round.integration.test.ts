// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { configurationDigest } from "../channel-grants";
import { currentDeliveryChannels, intentPrefix } from "../delivery-intent";
import { acknowledgeAlertIncident, escalateOverdueAlertIncidents, openOrRefreshAlertIncident, resolveAlertIncident } from "../incidents";
import { updateAlertRule } from "../service";

const { webhook } = vi.hoisted(() => ({ webhook: vi.fn() }));
vi.mock("@/lib/security/webhook-url", async (original) => ({
  ...await original<typeof import("@/lib/security/webhook-url")>(), fetchWebhookSafely: webhook,
}));

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("alert routing and incident rounds (PostgreSQL)", () => {
  const id = `eval-${randomUUID()}`;
  const where = { id };
  const oldUrl = "https://example.test/old";
  const newUrl = "https://example.test/new";
  const base = {
    ruleId: id, ruleName: id, metric: "cpu_usage", serverName: id, serverId: id, teamId: id,
    title: "CPU", message: "CPU above threshold", operator: "gt", threshold: 75, value: 80,
    webhookUrl: oldUrl, notifyChannels: ["webhook"], onCallUserIds: [],
  };
  const session = { userId: id, roles: [], currentTeamId: id };
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) throw new Error("requires an isolated loopback test database");
    await prisma.team.create({ data: { id, name: id, slug: id } });
    await prisma.user.create({ data: { id, username: id, passwordHash: "test" } });
    await prisma.server.create({ data: { id, teamId: id, name: id, host: "localhost", port: 1, username: "test", tags: [] } });
    await prisma.alertRule.create({ data: { id, name: id, teamId: id, metric: base.metric, operator: "gt", threshold: 75, notifyChannels: ["webhook"], webhookUrl: oldUrl } });
  });
  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: { startsWith: intentPrefix(id) } } });
    await prisma.alertRule.deleteMany({ where });
    await prisma.server.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.team.deleteMany({ where });
    await prisma.$disconnect();
  });

  it("drops revoked routes, clears their retry and guards ACK and readings by round", async () => {
    const readRule = () => prisma.alertRule.findUniqueOrThrow({ where });
    const version = configurationDigest(await readRule());
    const evaluation = (version: string, second: number) => ({ version, sampledAt: new Date(1_800_000_000_000 + second * 1000) });
    const old = { ...base, evaluation: evaluation(version, 1) };
    await prisma.alertRule.update({ where, data: { webhookUrl: newUrl } });
    expect(await currentDeliveryChannels(prisma, old)).toBeNull();
    expect(await openOrRefreshAlertIncident(old)).toMatchObject({ fired: false });
    expect(webhook).not.toHaveBeenCalled();

    const v2 = configurationDigest(await readRule());
    webhook.mockResolvedValue({ ok: true, response: { ok: false, status: 503 } });
    const current = { ...base, webhookUrl: newUrl, evaluation: evaluation(v2, 2) };
    const { incidentId } = await openOrRefreshAlertIncident(current);
    const read = () => prisma.alertIncident.findUniqueOrThrow({ where: { id: incidentId! } });
    const first = await read();
    expect(first.pendingNotifyChannels).toEqual(["webhook"]);
    expect(webhook).toHaveBeenCalledTimes(1);
    await prisma.alertRule.update({ where, data: { notifyChannels: [] } });
    const v3 = configurationDigest(await readRule());
    const sample = (second: number, value: number) => ({ ...current, value, notifyChannels: [], evaluation: evaluation(v3, second) });
    await openOrRefreshAlertIncident(sample(3, 90));
    expect(await read()).toMatchObject({ value: 90, pendingNotifyChannels: [], nextNotifyAt: null });
    expect(await resolveAlertIncident(sample(2, 10))).toMatchObject({ resolved: false });
    expect(await resolveAlertIncident(sample(4, 10))).toMatchObject({ resolved: true });
    expect(await openOrRefreshAlertIncident(sample(5, 95))).toMatchObject({ fired: true, incidentId });
    const reopened = await read();
    expect(reopened.createdAt.getTime()).toBeGreaterThan(first.createdAt.getTime());
    await openOrRefreshAlertIncident(sample(3, 81));
    expect(await read()).toMatchObject({ status: "OPEN", value: 95 });
    await expect(acknowledgeAlertIncident({ incidentId: reopened.id, userId: id, session, openedAt: first.createdAt })).rejects.toMatchObject({ status: 409 });
    expect(await acknowledgeAlertIncident({ incidentId: reopened.id, userId: id, session, openedAt: reopened.createdAt })).toMatchObject({ status: "ACKNOWLEDGED", teamId: id });
    await prisma.alertIncident.delete({ where: { id: reopened.id } });
    await expect(acknowledgeAlertIncident({ incidentId: reopened.id, userId: id, session, openedAt: reopened.createdAt })).rejects.toMatchObject({ status: 404 });
    expect(webhook).toHaveBeenCalledTimes(1);
  });

  it("clears live and capacity duration stamps only when the effective condition changes", async () => {
    for (const metric of ["cpu_usage", "capacity_disk_days"]) {
      const start = new Date();
      const state = { [id]: start.toISOString() };
      await prisma.alertRule.update({ where, data: { metric, operator: "gt", threshold: 70, matchState: state, lastMatchedAt: start } });
      await updateAlertRule(id, { threshold: 70 }, session);
      expect(await prisma.alertRule.findUniqueOrThrow({ where })).toMatchObject({ matchState: state, lastMatchedAt: start });
      await updateAlertRule(id, { threshold: 90 }, session);
      expect(await prisma.alertRule.findUniqueOrThrow({ where })).toMatchObject({ matchState: {}, lastMatchedAt: null });
    }
  });

  it.each([1, 2])("uses only a verifiable round start when escalating a legacy L%i incident", async (level) => {
    const openedAt = new Date(Date.now() - 600_000);
    await prisma.alertRule.update({ where, data: { metric: base.metric, notifyChannels: ["webhook"], webhookUrl: newUrl, escalationMinutes: 1 } });
    const incident = await prisma.alertIncident.create({ data: {
      fingerprint: id + "-legacy-" + level, ruleId: id, serverId: id, serverName: id, metric: base.metric,
      operator: "gt", threshold: 75, value: 80, title: "CPU", message: "CPU above threshold",
      level, createdAt: new Date(0), lastNotifiedAt: openedAt,
    } });
    webhook.mockReset().mockResolvedValue({ ok: true, response: { ok: true } });
    const escalate = () => escalateOverdueAlertIncidents({ ruleTeamWhere: { id } });
    const context = (): string[] => JSON.parse(webhook.mock.lastCall![1].body).context;
    try {
      expect(await escalate()).toMatchObject({ escalated: 1 });
      if (level === 1) {
        expect(context()).toContain("Open since: " + openedAt.toISOString());
        await prisma.alertIncident.update({ where: { id: incident.id }, data: { lastNotifiedAt: new Date(Date.now() - 120_000) } });
        expect(await escalate()).toMatchObject({ escalated: 1 });
        expect(context()).toContain("Open since: " + openedAt.toISOString());
      } else {
        expect(context().some((line) => line.startsWith("Open since:"))).toBe(false);
      }
    } finally { await prisma.alertIncident.delete({ where: { id: incident.id } }); }
  });
});
