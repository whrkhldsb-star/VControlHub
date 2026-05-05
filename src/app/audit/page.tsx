import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getAuditStats } from "@/lib/audit/service";

import { AuditLogClient } from "./audit-client";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
	const session = await requireSession("/audit");
	const canRead = sessionHasPermission(session, "audit:read");

	let stats = null;
	if (canRead) {
		try {
			stats = await getAuditStats();
		} catch {
			// DB might be empty
		}
	}

	return (
		<main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100">
			<div className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
				<header className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight text-white">审计日志</h1>
					<p className="mt-1.5 text-sm text-slate-500">平台操作追踪与安全审计</p>
				</header>

				{!canRead ? (
					<EmptyState text="你没有查看审计日志的权限。" />
				) : (
					<>
						{stats && (
							<section className="grid gap-3 sm:grid-cols-4 mb-8">
								<StatCard label="总记录" value={String(stats.total)} />
								<StatCard label="24h 新增" value={String(stats.recentCount)} accent />
								<StatCard label="WARNING" value={String(stats.bySeverity["WARNING"] ?? 0)} accentColor="amber" />
								<StatCard label="CRITICAL" value={String(stats.bySeverity["CRITICAL"] ?? 0)} accentColor="rose" />
							</section>
						)}

						<AuditLogClient />
					</>
				)}
			</div>
		</main>
	);
}

function StatCard({ label, value, accent, accentColor }: { label: string; value: string; accent?: boolean; accentColor?: "cyan" | "amber" | "rose" }) {
	const colorMap = { cyan: "text-cyan-300", amber: "text-amber-300", rose: "text-rose-300" };
	const c = accent && !accentColor ? "text-cyan-300" : accentColor ? colorMap[accentColor] : "text-white";
	return (
		<article className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors duration-150">
			<div className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</div>
			<div className={`mt-1.5 text-2xl font-semibold ${c}`}>{value}</div>
		</article>
	);
}

function EmptyState({ text }: { text: string }) {
	return <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-6 text-sm text-slate-500 text-center">{text}</div>;
}
