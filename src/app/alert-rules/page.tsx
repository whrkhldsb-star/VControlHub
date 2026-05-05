import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listAlertRules } from "@/lib/alert/service";
import { listServerProfiles } from "@/lib/server/service";

import { AlertRuleListClient } from "./alert-rule-list-client";

export const dynamic = "force-dynamic";

export default async function AlertRulesPage() {
	const session = await requireSession("/alert-rules");
	const canManage = sessionHasPermission(session, "user:manage");

	const [rules, servers] = await Promise.all([
		canManage ? listAlertRules() : Promise.resolve([]),
		listServerProfiles(),
	]);

	const serialized = rules.map((r) => ({
		id: r.id, name: r.name, metric: r.metric, operator: r.operator,
		threshold: r.threshold, durationSeconds: r.durationSeconds,
		serverIds: r.serverIds, notifyChannels: r.notifyChannels,
		webhookUrl: r.webhookUrl, cooldownMinutes: r.cooldownMinutes,
		enabled: r.enabled, lastTriggeredAt: r.lastTriggeredAt?.toISOString() ?? null,
		createdAt: r.createdAt.toISOString(),
	}));

	const serverOptions = servers.map((s) => ({ id: s.id, name: s.name }));

	return (
		<main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100">
			<div className="mx-auto max-w-5xl px-6 py-10 lg:px-10">
				<header className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight text-white">智能告警</h1>
					<p className="mt-1.5 text-sm text-slate-500">
						配置自动告警规则，异常指标自动触发通知与 Webhook
					</p>
				</header>
				<AlertRuleListClient rules={serialized} servers={serverOptions} canManage={canManage} />
			</div>
		</main>
	);
}
