import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listAlertRules } from "@/lib/alert/service";
import { listServerProfiles } from "@/lib/server/service";
import { listPlaybooks } from "@/lib/playbook/service";
import { getServerLocale, t } from "@/lib/i18n/translations";

import { AlertRuleListClient } from "./alert-rule-list-client";
import { PageShell, PageHeader } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function AlertRulesPage() {
	const session = await requireSession("/alert-rules");
	const canManage = sessionHasPermission(session, "notification:manage");
	const locale = await getServerLocale();

	const [rules, servers, playbooks] = await Promise.all([
		canManage ? listAlertRules() : Promise.resolve([]),
		listServerProfiles(),
		canManage ? listPlaybooks() : Promise.resolve([]),
	]);

	const serialized = rules.map((r) => ({
		id: r.id, name: r.name, metric: r.metric, operator: r.operator,
		threshold: r.threshold, durationSeconds: r.durationSeconds,
		serverIds: r.serverIds, notifyChannels: r.notifyChannels,
		playbookIds: r.playbookIds ?? [],
		webhookConfigured: Boolean(r.webhookUrl), cooldownMinutes: r.cooldownMinutes,
		silenceWindows: r.silenceWindows ?? [],
		enabled: r.enabled, lastTriggeredAt: r.lastTriggeredAt?.toISOString() ?? null,
		createdAt: r.createdAt.toISOString(),
	}));

	const serverOptions = servers.map((s) => ({ id: s.id, name: s.name }));
	const playbookOptions = playbooks.map((p) => ({ id: p.id, name: p.name, enabled: p.enabled }));

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
				eyebrow={t("alertRulesPage.eyebrow", locale)}
				title={t("alertRulesPage.title", locale)}
				description={t("alertRulesPage.desc", locale)}
			/>
			<AlertRuleListClient rules={serialized} servers={serverOptions} playbooks={playbookOptions} canManage={canManage} />
		</PageShell>
	);
}
