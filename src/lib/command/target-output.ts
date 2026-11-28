/**
 * Bounded, team-scoped SQL tails for CommandTarget stdout/stderr.
 *
 * Extracted from src/lib/operation-task/service.ts so Operation Tasks,
 * GET /api/commands/[id], GET /api/ai/hosted-actions/[id], and AI hosted
 * outcome write-back all share one bounded, tenant-safe query path.
 */
import { Prisma } from "@prisma/client";
import { rawServerScope } from "@/lib/auth/team-scope";
import type { Permission, RoleKey } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";

export const COMMAND_OUTPUT_TAIL_CHARS = 1_024;
export const COMMAND_DETAIL_OUTPUT_TAIL_CHARS = 8_000;

export type OutputTail = { stdout: string | null; stderr: string | null };

export type OutputTailSessionScope = {
  userId: string;
  roles: RoleKey[];
  currentTeamId: string | null;
  permissions?: Permission[];
};

export async function fetchTargetOutputTails(
  ids: string[],
  session: OutputTailSessionScope,
  maxChars = COMMAND_OUTPUT_TAIL_CHARS,
): Promise<Map<string, OutputTail>> {
  const tails = new Map<string, OutputTail>();
  if (ids.length === 0) return tails;
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; stdout: string | null; stderr: string | null }>>(
      Prisma.sql`
        SELECT t.id,
               right(coalesce(t.stdout, ''), ${maxChars}::int) AS stdout,
               right(coalesce(t.stderr, ''), ${maxChars}::int) AS stderr
        FROM command_targets t
        JOIN servers s ON s.id = t."serverId"
        JOIN command_requests r ON r.id = t."commandRequestId"
        WHERE t.id = ANY(${ids}::text[])
          AND s."teamId" IS NOT DISTINCT FROM r."teamId"
          AND (${rawServerScope(session, "canRead")})
      `,
    );
    for (const row of rows) tails.set(row.id, { stdout: row.stdout, stderr: row.stderr });
  } catch {
    // Preview enrichment only — never fail the caller over a raw read mismatch.
  }
  return tails;
}
