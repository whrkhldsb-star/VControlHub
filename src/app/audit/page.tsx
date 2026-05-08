import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getAuditStats } from "@/lib/audit/service";
import { AuditLogClient } from "./audit-client";
import { PageShell, StatCard, EmptyState } from "@/components/page-shell";

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
		<PageShell maxW="max-w-7xl">
			<header className="mb-8">
				<h1 className="text-3xl font-semibold tracking-tight text-white">审计日志</h1>
				<p className="mt-1.5 text-sm text-slate-500">平台操作追踪与安全审计</p>
			</header>

			{!canRead ? (
				<EmptyState text="你没有查看审计日志的权限。" variant="boxed" />
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
		</PageShell>
	);
}
