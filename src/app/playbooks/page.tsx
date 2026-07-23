import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listPlaybooks, listRecentPlaybookRunsForPlaybooks } from "@/lib/playbook/service";
import { listServerProfiles } from "@/lib/server/service";
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
	// Team-scoped VPS options for run_command step target picker (create form).
	const serverOptions = canManage
		? (await listServerProfiles(session)).map((s) => ({
				id: s.id,
				name: s.name,
				host: s.host,
				enabled: s.enabled,
			}))
		: [];

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
	if (canRead && playbooks.length > 0) {
		const batch = await listRecentPlaybookRunsForPlaybooks(
			playbooks.map((p) => p.id),
			session,
			5,
		);
		for (const p of playbooks) {
			const runs = batch[p.id] ?? [];
			runsByPlaybook[p.id] = runs.map((r) => ({
				id: r.id,
				status: r.status,
				dryRun: r.dryRun,
				startedAt: r.startedAt ? r.startedAt.toISOString() : null,
				completedAt: r.completedAt ? r.completedAt.toISOString() : null,
				errorMessage: r.errorMessage,
				stepResults: r.stepResults,
			}));
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
				servers={serverOptions}
				canManage={canManage}
				canRun={canRun}
			/>
		</PageShell>
	);
}
