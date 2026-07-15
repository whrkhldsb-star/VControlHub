import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listPlaybookRuns, listPlaybooks } from "@/lib/playbook/service";
import { getServerLocale, t } from "@/lib/i18n/translations";

import { PageShell, PageHeader } from "@/components/page-shell";
import { PlaybookListClient } from "./playbook-list-client";

export const dynamic = "force-dynamic";

export default async function PlaybooksPage() {
	const session = await requireSession("/playbooks");
	const canManage = sessionHasPermission(session, "playbook:manage");
	const canRun = sessionHasPermission(session, "playbook:run");
	const canRead = sessionHasPermission(session, "playbook:read");
	const locale = await getServerLocale();

	const playbooks = canRead ? await listPlaybooks(session) : [];

	// Fetch run history for each playbook in parallel; empty array per playbook
	// is fine for the M04 plan (limit to 5 per playbook, latest first).
	const runsByPlaybook: Record<string, Array<{
		id: string;
		status: string;
		dryRun: boolean;
		startedAt: string | null;
		completedAt: string | null;
		errorMessage: string | null;
		stepResults: Array<{ stepId: string; status: string; summary?: string; error?: string }>;
	}>> = {};
	if (canRead) {
		const runLists = await Promise.all(
			playbooks.map(async (p) => {
				const runs = await listPlaybookRuns(p.id, session);
				return { id: p.id, runs: runs.slice(0, 5).map((r) => ({
					id: r.id,
					status: r.status,
					dryRun: r.dryRun,
					startedAt: r.startedAt?.toISOString() ?? null,
					completedAt: r.completedAt?.toISOString() ?? null,
					errorMessage: r.errorMessage,
					stepResults: r.stepResults,
				})) };
			}),
		);
		for (const { id, runs } of runLists) {
			runsByPlaybook[id] = runs;
		}
	}

	const serialized = playbooks.map((p) => ({
		id: p.id,
		name: p.name,
		description: p.description,
		triggerType: p.triggerType,
		triggerConfig: p.triggerConfig,
		steps: p.steps,
		chainRetry: p.chainRetry,
		enabled: p.enabled,
		createdAt: p.createdAt.toISOString(),
	}));

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
				eyebrow={t("playbooksPage.eyebrow", locale)}
				title={t("playbooksPage.title", locale)}
				description={t("playbooksPage.desc", locale)}
			/>
			<PlaybookListClient
				playbooks={serialized}
				runsByPlaybook={runsByPlaybook}
				canManage={canManage}
				canRun={canRun}
			/>
		</PageShell>
	);
}
