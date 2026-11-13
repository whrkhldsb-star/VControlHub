"use client";

import { ButtonLink } from "@/components/action-button";
import { AlertTriangle, Check, Clock } from "@/components/icons";
import { attentionTone, countAttention, type AttentionCheck, type AttentionKind } from "@/lib/dashboard/attention";
import { useI18n } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/ui/cn";

const COPY: Record<AttentionKind, { found: string; clear: string; action: string }> = {
	alerts: {
		found: "dashboard.attention.alerts.found",
		clear: "dashboard.attention.alerts.clear",
		action: "dashboard.attention.alerts.action",
	},
	failedTasks: {
		found: "dashboard.attention.failedTasks.found",
		clear: "dashboard.attention.failedTasks.clear",
		action: "dashboard.attention.failedTasks.action",
	},
	approvals: {
		found: "dashboard.attention.approvals.found",
		clear: "dashboard.attention.approvals.clear",
		action: "dashboard.attention.approvals.action",
	},
};

const TONE_TEXT = { danger: "text-[var(--danger)]", warning: "text-[var(--warning)]" } as const;

/**
 * The first thing on the dashboard: whether anything is waiting for this account, and the way to it.
 *
 * The same rows every time — one per check the account can see — so a glance finds them where they were;
 * a row that found something says how many, names the newest and links to the page that deals with it.
 * The headline is the one large piece of type in the page's content, and this is the one card that carries its
 * state (a bar on its leading edge and the headline's icon); every other card stays neutral.
 */
export function DashboardAttention({ checks, checkedAt }: { checks: AttentionCheck[]; checkedAt: string }) {
	const { t } = useI18n();
	if (checks.length === 0) return null;
	const found = countAttention(checks);
	const tone = attentionTone(checks);

	return (
		<section
			aria-labelledby="dashboard-attention-title"
			data-card
			data-attention={tone ?? "clear"}
			className="relative mb-6 overflow-hidden !p-0"
		>
			{tone ? <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", tone === "danger" ? "bg-[var(--danger)]" : "bg-[var(--warning)]")} /> : null}
			<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 pb-4 pt-5">
				{/* The answer the page opens with, so it takes the page title's size. */}
				<h2 id="dashboard-attention-title" className="ui-title-page flex min-w-0 items-center gap-3">
					<span
						aria-hidden
						className={cn(
							"flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
							tone === "danger"
								? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]"
								: tone === "warning"
									? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]"
									: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
						)}
					>
						{tone === "danger" ? <AlertTriangle size={16} /> : tone === "warning" ? <Clock size={16} /> : <Check size={16} strokeWidth={2.5} />}
					</span>
					{found === 0
						? t("dashboard.attention.clear")
						: found === 1
							? t("dashboard.attention.foundOne")
							: t("dashboard.attention.found", { count: found })}
				</h2>
				<p className="text-xs tabular-nums text-[var(--text-muted)]">{t("dashboard.attention.checkedAt", { time: checkedAt })}</p>
			</div>
			<ul className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
				{checks.map((check) => (
					<li key={check.kind} data-attention-check={check.kind} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 sm:flex-nowrap">
						{check.count > 0 ? (
							<>
								<span aria-hidden className={cn("shrink-0", TONE_TEXT[check.tone])}>
									{check.tone === "danger" ? <AlertTriangle size={16} /> : <Clock size={16} />}
								</span>
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium text-[var(--text-primary)]">{t(COPY[check.kind].found, { count: check.count })}</p>
									{check.latest ? (
										<p className="mt-0.5 truncate text-xs text-[var(--text-muted)]" title={check.latest}>
											{t("dashboard.attention.latest", { title: check.latest })}
										</p>
									) : null}
								</div>
								<ButtonLink href={check.href} size="sm" variant="secondary" className="shrink-0">
									{t(COPY[check.kind].action)}
								</ButtonLink>
							</>
						) : (
							<>
								<span aria-hidden className="shrink-0 text-[var(--success)]">
									<Check size={16} strokeWidth={2.5} />
								</span>
								<p className="min-w-0 flex-1 text-sm text-[var(--text-secondary)]">{t(COPY[check.kind].clear)}</p>
							</>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}
