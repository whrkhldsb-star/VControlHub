/**
 * TR-032 E02: /ai-ops — 智能 AI 运维 UI 页面。
 *
 * RSC reads the initial summary + recent logs + settings (mode / provider
 * / schedule hour) and hands them to a client component for filtering,
 * manual scan trigger, recommendation execute, and settings editor. The
 * scan trigger is synchronous and returns the latest log row, mirroring
 * the cost-summary page pattern.
 */
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listAiOpsLogs, summariseAiOps } from "@/lib/ai/ops/service";
import { AI_OPS_DEFAULT_SCHEDULE_HOUR } from "@/lib/ai/ops/types";
import { getSetting } from "@/lib/settings/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { PageHeader, PageShell } from "@/components/page-shell";

import { AiOpsPageClient } from "./ai-ops-page-client";

export const dynamic = "force-dynamic";

async function loadInitialSettings() {
	const mode = await getSetting("ai.ops.mode");
	const providerId = await getSetting("ai.ops.provider");
	return {
		mode: mode === "autonomous" ? ("autonomous" as const) : ("recommendation" as const),
		providerId: providerId.trim() ? providerId : null,
		scanScheduleHour: AI_OPS_DEFAULT_SCHEDULE_HOUR,
	};
}

export default async function AiOpsPage() {
	const session = await requireSession("/ai-ops");
	const canRead = sessionHasPermission(session, "ai:ops:read");
	const canManage = sessionHasPermission(session, "ai:ops:manage");
	const canAutonomous = sessionHasPermission(session, "ai:ops:autonomous");
	const locale = await getServerLocale();

	if (!canRead) {
		return (
			<PageShell maxW="max-w-7xl">
				<PageHeader
					eyebrow={t("aiOpsPage.eyebrow", locale)}
					title={t("aiOpsPage.title", locale)}
					description={t("aiOpsPage.desc", locale)}
				/>
				<div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-sm text-amber-100">
					缺少 ai:ops:read 权限
				</div>
			</PageShell>
		);
	}

	const [summary, logs, settings] = await Promise.all([
		summariseAiOps(),
		listAiOpsLogs({ limit: 50 }),
		loadInitialSettings(),
	]);

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
				eyebrow={t("aiOpsPage.eyebrow", locale)}
				title={t("aiOpsPage.title", locale)}
				description={t("aiOpsPage.desc", locale)}
			/>
			<AiOpsPageClient
				initialSummary={summary}
				initialLogs={logs}
				initialSettings={settings}
				canManage={canManage}
				canAutonomous={canAutonomous}
			/>
		</PageShell>
	);
}
