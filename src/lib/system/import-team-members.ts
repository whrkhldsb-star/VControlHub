import type { ExportFile, ImportOptions } from "./config-schema";
import type { Tx } from "./import-executors-helpers";
import { loadImportReferences } from "./import-reference-scope";

type Member = ExportFile["tables"]["teamMembers"][number];

export async function loadTeamMemberships(db: Pick<Tx, "teamMember">, records: Member[]) {
  const rows = await loadImportReferences(records.map((row) => row.userId), (ids) => db.teamMember.findMany({
    where: { userId: { in: ids } }, select: { userId: true, teamId: true },
  }));
  return new Map(rows.map((row) => [row.userId, row.teamId]));
}

export function planTeamMemberImport(
  records: Member[],
  options: ImportOptions,
  members: Map<string, string>,
  users: ReadonlySet<string>,
  teams: ReadonlySet<string>,
  templates: ReadonlySet<string>,
) {
  const plan: Array<{ row: Member; action: "create" | "update"; moved: boolean }> = [];
  const seen = new Set<string>();
  for (const row of records) {
    if (!users.has(row.userId) || !teams.has(row.teamId) || !templates.has(row.identityTemplateId)) continue;
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    const previousTeamId = members.get(row.userId);
    if (previousTeamId !== undefined && !options.overwriteExisting) continue;
    plan.push({ row, action: previousTeamId === undefined ? "create" : "update", moved: previousTeamId !== undefined && previousTeamId !== row.teamId });
  }
  return plan;
}
