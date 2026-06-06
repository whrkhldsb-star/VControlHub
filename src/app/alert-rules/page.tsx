import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listAlertRules } from "@/lib/alert/service";
import { listServerProfiles } from "@/lib/server/service";

import { AlertRuleListClient } from "./alert-rule-list-client";
import { PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function AlertRulesPage() {
	const session = await requireSession("/alert-rules");
	const canManage = sessionHasPermission(session, "notification:manage");

	const [rules, servers] = await Promise.all([
		canManage ? listAlertRules() : Promise.resolve([]),
		listServerProfiles(),
	]);

	const serialized = rules.map((r) => ({
		id: r.id, name: r.name, metric: r.metric, operator: r.operator,
		threshold: r.threshold, durationSeconds: r.durationSeconds,
		serverIds: r.serverIds, notifyChannels: r.notifyChannels,
		webhookConfigured: Boolean(r.webhookUrl), cooldownMinutes: r.cooldownMinutes,
		silenceWindows: r.silenceWindows ?? [],
		enabled: r.enabled, lastTriggeredAt: r.lastTriggeredAt?.toISOString() ?? null,
		createdAt: r.createdAt.toISOString(),
	}));

	const serverOptions = servers.map((s) => ({ id: s.id, name: s.name }));

	return (
		<PageShell maxW="max-w-7xl">
				<header className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight text-white light:text-slate-900">智能告警</h1>
					<p className="mt-1.5 text-sm text-slate-500">
						配置自动告警规则，异常指标自动触发通知与 Webhook
					</p>
				</header>
				<AlertRuleListClient rules={serialized} servers={serverOptions} canManage={canManage} />
		</PageShell>
	);
}
