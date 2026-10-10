"use client";

import Link from "next/link";

import { useI18n } from "@/lib/i18n/use-locale";
import type { SetupChecklistItem } from "@/lib/dashboard/setup-checklist";
import { countPendingSetupItems } from "@/lib/dashboard/setup-checklist";
import { ActionButton } from "@/components/action-button";
import { writeLocalStorageValue } from "@/lib/browser-storage";
import { useBrowserStorageSnapshot } from "@/lib/hooks/use-browser-storage-snapshot";
import { Check } from "@/components/icons";

const DISMISS_KEY = "vch.setupChecklist.dismissed";

function readDismissed(storage: Storage): boolean {
	return storage.getItem(DISMISS_KEY) === "1";
}

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
	const dismissed = useBrowserStorageSnapshot(DISMISS_KEY, readDismissed, false);

	const pending = countPendingSetupItems(items);
	if (pending === 0 || dismissed) return null;

	const dismiss = () => {
		writeLocalStorageValue(DISMISS_KEY, "1");
	};

	const done = items.length - pending;
	return (
		<section
			aria-label={t("dashboard.setup.title")}
			data-card
			className="mb-6 !p-0"
		>
			<div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
				<div className="min-w-0">
					<p className="text-xs font-medium text-[var(--accent)]">
						{t("dashboard.setup.eyebrow")}
					</p>
					<h2 className="ui-title-section mt-0.5">
						{t("dashboard.setup.title")}
					</h2>
					<p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
						{t("dashboard.setup.description", { count: pending })}
					</p>
				</div>
				<div className="flex items-center gap-3">
					<div className="hidden items-center gap-2 text-xs tabular-nums text-[var(--text-muted)] sm:flex" aria-hidden="true">
						<span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--surface-elevated)]">
							<span className="block h-full rounded-full bg-[var(--color-action)]" style={{ width: `${Math.round((done / Math.max(items.length, 1)) * 100)}%` }} />
						</span>
						{done}/{items.length}
					</div>
					<ActionButton variant="ghost" onClick={dismiss}>
						{t("dashboard.setup.dismiss")}
					</ActionButton>
				</div>
			</div>

			<ul className="grid gap-px border-t border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-5">
				{items.map((item) => (
					<li key={item.id} className="bg-[var(--surface)] first:rounded-bl-[var(--radius-card)] last:rounded-br-[var(--radius-card)]">
						<Link
							href={item.href}
							className="group flex h-full items-start gap-2.5 px-4 py-3 text-sm transition hover:bg-[var(--surface-hover)]"
						>
							<span
								className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ${
									item.done
										? "bg-[var(--color-success-action)] text-white"
										: "border border-[var(--border-strong)] text-[var(--text-muted)]"
								}`}
								aria-hidden
							>
								{item.done ? <Check size={11} strokeWidth={3} /> : null}
							</span>
							<span className="min-w-0">
								<span className={`block font-medium ${item.done ? "text-[var(--text-muted)] line-through decoration-[var(--border-strong)]" : "text-[var(--text-primary)]"}`}>
									{t(ITEM_LABEL_KEY[item.id])}
								</span>
								<span className="mt-0.5 block text-xs leading-5 text-[var(--text-muted)]">
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
