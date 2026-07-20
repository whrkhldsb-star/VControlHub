"use client";

import Link from "next/link";
import { useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import type { SetupChecklistItem } from "@/lib/dashboard/setup-checklist";
import { countPendingSetupItems } from "@/lib/dashboard/setup-checklist";

const DISMISS_KEY = "vch.setupChecklist.dismissed";

const ITEM_LABEL_KEY: Record<SetupChecklistItem["id"], string> = {
	servers: "dashboard.setup.item.servers",
	alertRules: "dashboard.setup.item.alertRules",
	notificationOutbound: "dashboard.setup.item.notificationOutbound",
	backupSchedule: "dashboard.setup.item.backupSchedule",
	costMonthly: "dashboard.setup.item.costMonthly",
};

const ITEM_HINT_KEY: Record<SetupChecklistItem["id"], string> = {
	servers: "dashboard.setup.hint.servers",
	alertRules: "dashboard.setup.hint.alertRules",
	notificationOutbound: "dashboard.setup.hint.notificationOutbound",
	backupSchedule: "dashboard.setup.hint.backupSchedule",
	costMonthly: "dashboard.setup.hint.costMonthly",
};

type Props = {
	items: SetupChecklistItem[];
};

export function DashboardSetupChecklist({ items }: Props) {
	const { t } = useI18n();
	const [dismissed, setDismissed] = useState(() => {
		if (typeof window === "undefined") return false;
		try {
			return window.localStorage.getItem(DISMISS_KEY) === "1";
		} catch {
			return false;
		}
	});

	const pending = countPendingSetupItems(items);
	if (pending === 0 || dismissed) return null;

	const dismiss = () => {
		try {
			window.localStorage.setItem(DISMISS_KEY, "1");
		} catch {
			/* ignore */
		}
		setDismissed(true);
	};

	return (
		<section
			aria-label={t("dashboard.setup.title")}
			className="rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-bg)]/40 p-4 shadow-sm"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--warning)]">
						{t("dashboard.setup.eyebrow")}
					</p>
					<h2 className="mt-0.5 text-sm font-semibold text-[var(--text-primary)]">
						{t("dashboard.setup.title")}
					</h2>
					<p className="mt-1 text-xs text-[var(--text-muted)]">
						{t("dashboard.setup.description").replace("{count}", String(pending))}
					</p>
				</div>
				<button
					type="button"
					onClick={dismiss}
					data-action-button
					data-variant="ghost"
					className="!min-h-11 !px-3 !text-xs"
				>
					{t("dashboard.setup.dismiss")}
				</button>
			</div>

			<ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
				{items.map((item) => (
					<li key={item.id}>
						<Link
							href={item.href}
							className={`flex min-h-11 items-start gap-2 rounded-xl border px-3 py-2.5 text-sm transition hover:border-[var(--border-strong,var(--border))] ${
								item.done
									? "border-[var(--success-border)] bg-[var(--success-bg)]/30 text-[var(--text-secondary)]"
									: "border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)]"
							}`}
						>
							<span
								className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
									item.done
										? "bg-[var(--success)] text-white"
										: "bg-[var(--surface-elevated)] text-[var(--text-muted)]"
								}`}
								aria-hidden
							>
								{item.done ? "✓" : "·"}
							</span>
							<span className="min-w-0">
								<span className="block font-medium">{t(ITEM_LABEL_KEY[item.id])}</span>
								<span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
									{t(ITEM_HINT_KEY[item.id])}
								</span>
							</span>
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
}
