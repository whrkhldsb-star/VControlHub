import { alertConditionChanged } from "@/lib/alert/service";
import { PLATFORM_ONLY_CHANNELS, verifiedRuleChannels } from "@/lib/alert/channel-grants";
import { canAlertRuleTargetTeam } from "@/lib/alert/rule-scope";
import { HUB_HOST_INSTANCE_KEY, isQuickServiceTargetConsistent } from "@/lib/quick-service/target-identity";
import type { ExportFile, ImportOptions } from "./config-schema";
import type { Tx } from "./import-executors-helpers";
import { planUniqueImport } from "./import-unique-rows";

type Tables = ExportFile["tables"];
export type TeamOwner = { teamId: string | null };
export type GrantUser = { teamId: string | null; isAdmin: boolean };

export async function loadImportReferences<K, T>(ids: Iterable<K>, find: (ids: K[]) => Promise<T[]>): Promise<T[]> {
  const wanted = [...new Set(ids)];
  const rows: T[] = [];
  for (let i = 0; i < wanted.length; i += 500) rows.push(...await find(wanted.slice(i, i + 500)));
  return rows;
}

/** The preview observes the dependency tables as they will look after import. */
export async function projectUniqueImportRows<T extends { id: string }, R extends { id: string }>(
  ids: string[],
  bundled: T[],
  overwrite: boolean,
  findById: (ids: string[]) => Promise<R[]>,
  findByKey: (keys: string[]) => Promise<R[]>,
  keyOf: (row: T | R) => string,
) {
  if (ids.length === 0) return new Map<string, T | R>();
  const [live, owners] = await Promise.all([
    loadImportReferences([...ids, ...bundled.map((row) => row.id)], findById),
    loadImportReferences(bundled.map(keyOf), findByKey),
  ]);
  const projected: Map<string, T | R> = byId([...live, ...owners]);
  const existing = [...projected.values()].map((row) => ({ id: row.id, key: keyOf(row) }));
  for (const { row } of planUniqueImport(bundled, existing, keyOf, overwrite)) projected.set(row.id, row);
  return projected;
}

export function projectTeamRows(db: Pick<Tx, "team">, ids: string[], bundled: Tables["teams"], overwrite: boolean) {
  return projectUniqueImportRows(ids, bundled, overwrite,
    (chunk) => db.team.findMany({ where: { id: { in: chunk } }, select: { id: true, slug: true } }),
    (chunk) => db.team.findMany({ where: { slug: { in: chunk } }, select: { id: true, slug: true } }),
    (team) => team.slug,
  );
}

export function canBindServerKey(server: { teamId?: string | null }, key: TeamOwner | undefined): boolean {
  return key !== undefined && key.teamId === (server.teamId ?? null);
}

export function loadGrantUsers(db: Pick<Tx, "user">, ids: Iterable<string>) {
  return loadImportReferences(ids, (chunk) => db.user.findMany({
    where: { id: { in: chunk } },
    select: {
      id: true,
      teamMembership: { select: { teamId: true } },
      roles: { select: { role: { select: { id: true, key: true } } } },
    },
  }));
}

export async function loadGrantUserScopes(db: Pick<Tx, "user">, ids: Iterable<string>) {
  const users = await loadGrantUsers(db, ids);
  return new Map(users.map((user) => [user.id, {
    teamId: user.teamMembership?.teamId ?? null,
    isAdmin: user.roles.some(({ role }) => role.key === "admin"),
  }]));
}

export function canImportResourceGrant(user: GrantUser | undefined, resource: TeamOwner | undefined): boolean {
  return !!user && !!resource && (user.isAdmin || (user.teamId !== null && user.teamId === resource.teamId));
}

export function quickServiceTarget(row: Pick<Tables["quickServices"][number], "instanceKey" | "serverId">) {
  return { instanceKey: row.instanceKey ?? HUB_HOST_INSTANCE_KEY, serverId: row.serverId ?? null };
}

export function hasImportableQuickServiceTarget(row: Tables["quickServices"][number], servers: ReadonlySet<string>): boolean {
  const { instanceKey, serverId } = quickServiceTarget(row);
  return isQuickServiceTargetConsistent(instanceKey, serverId) && (serverId === null || servers.has(serverId));
}

function hasImportableAlertReferences(
  rule: Tables["alertRules"][number],
  servers: ReadonlyMap<string, TeamOwner>,
  playbooks: ReadonlyMap<string, TeamOwner>,
  users: ReadonlyMap<string, GrantUser>,
): boolean {
  const allows = (owners: ReadonlyMap<string, TeamOwner>, id: string) => {
    const owner = owners.get(id);
    return !!owner && canAlertRuleTargetTeam(rule.teamId, owner.teamId);
  };
  // Reject the whole rule if its explicit list is invalid: an empty server list
  // would expand the rule to every server in its scope.
  return rule.serverIds.every((id) => allows(servers, id))
    && (rule.playbookIds ?? []).every((id) => allows(playbooks, id))
    && (rule.onCallUserIds ?? []).every((id) => canImportResourceGrant(users.get(id), { teamId: rule.teamId ?? null }));
}

export async function planAlertRuleImport(
  db: Pick<Tx, "alertRule">,
  records: Tables["alertRules"],
  options: ImportOptions,
  servers: ReadonlyMap<string, TeamOwner>,
  playbooks: ReadonlyMap<string, TeamOwner>,
  users: ReadonlyMap<string, GrantUser>,
  mode?: ExportFile["exportMode"],
) {
  const valid = records.filter((rule) => hasImportableAlertReferences(rule, servers, playbooks, users));
  const existing = await loadImportReferences(valid.map((row) => row.id), (ids) => db.alertRule.findMany({
    where: { id: { in: ids } }, select: { id: true, teamId: true, metric: true, threshold: true, operator: true, webhookUrl: true },
  }));
  const current = byId(existing);
  const sameTeam = valid.filter((row) => !current.has(row.id) || current.get(row.id)!.teamId === (row.teamId ?? null));
  const plan = planUniqueImport(sameTeam, existing.map(({ id }) => ({ id, key: id })), (row) => row.id, options.overwriteExisting);
  const result = [];
  for (const item of plan) {
    const old = current.get(item.row.id);
    const url = item.row.webhookUrl || (mode !== "full" ? old?.webhookUrl : null);
    const row = item.row;
    const channels = row.notifyChannels ?? [];
    const verified = row.teamId && channels.some((c) => PLATFORM_ONLY_CHANNELS.includes(c))
      ? await verifiedRuleChannels({ ...row, teamId: row.teamId, webhookUrl: url ?? null, escalationMinutes: row.escalationMinutes ?? 30 }) : channels;
    result.push({ ...item, pendingApproval: verified.length !== channels.length, noApprovedChannel: channels.length > 0 && verified.length === 0, missingWebhook: item.row.notifyChannels?.includes("webhook") && !url,
      metricChanged: old !== undefined && alertConditionChanged(old, item.row) });
  }
  return result;
}

export function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}
