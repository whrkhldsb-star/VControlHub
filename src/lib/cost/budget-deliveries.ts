import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// Native installers provision the ledger with the migration role. Existing
// installations can initialize it on first use. Ordinary checks need only DML.
export async function ensureBudgetDeliveryTable({ backfill = false } = {}) {
	const [table] = await prisma.$queryRaw<{ present: boolean }[]>`
		SELECT to_regclass('cost_budget_alert_deliveries') IS NOT NULL AS present
	`;
	if (table?.present && !backfill) return;
	await prisma.$transaction(async tx => {
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext('cost_budget_alert_deliveries'))`;
		if (!table?.present) {
			await tx.$executeRaw`
				CREATE TABLE IF NOT EXISTS cost_budget_alert_deliveries (
					budget_id text NOT NULL REFERENCES cost_budgets(id) ON DELETE CASCADE,
					period_start date NOT NULL,
					user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
					PRIMARY KEY (budget_id, period_start, user_id)
				)`;
			await tx.$executeRaw`CREATE INDEX IF NOT EXISTS cost_budget_alert_deliveries_user_idx ON cost_budget_alert_deliveries(user_id)`;
		}
		// Capture surviving receipts at rollout, before users can delete their
		// old inbox rows. Every budget period starts on the first of a month.
		await tx.$executeRaw`
			INSERT INTO cost_budget_alert_deliveries (budget_id, period_start, user_id)
			SELECT b.id, link.parts[2]::date, n."userId"
			FROM notifications n
			CROSS JOIN LATERAL regexp_matches(n."actionUrl",
				'^/cost-summary[?]budget=([^&]+)&periodStart=((?!0000)[0-9]{4}-(?:0[1-9]|1[0-2])-01)$') AS link(parts)
			JOIN cost_budgets b ON b.id = link.parts[1] AND b."teamId" IS NOT DISTINCT FROM n."teamId"
			WHERE n.type = 'system' AND (n."messageCode" = 'costBudgetAlert' OR n."messageCode" IS NULL)
			ON CONFLICT DO NOTHING`;
	}, { timeout: 120_000 });
}

export async function claimBudgetDeliveries(tx: Prisma.TransactionClient, budgetId: string, periodStart: string, userIds: string[]) {
	const claimed = await tx.$queryRaw<{ user_id: string }[]>`
		INSERT INTO cost_budget_alert_deliveries (budget_id, period_start, user_id)
		SELECT ${budgetId}, ${periodStart}::date, id FROM "User" WHERE id IN (${Prisma.join(userIds)})
		ON CONFLICT DO NOTHING RETURNING user_id
	`;
	return claimed.map(row => row.user_id);
}
