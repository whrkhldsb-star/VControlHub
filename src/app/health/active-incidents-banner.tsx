"use client";

import { useCallback, useEffect, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";

type ActiveAnnouncement = {
	id: string;
	title: string;
	body: string;
	level: string;
	startsAt: string;
	expiresAt: string | null;
	pinned: boolean;
};

const INCIDENT_LEVELS = new Set(["incident", "maintenance"]);

export function ActiveIncidentsBanner() {
  const { t, locale } = useI18n();
	const [incidents, setIncidents] = useState<ActiveAnnouncement[]>([]);
	const [dismissed, setDismissed] = useState<Set<string>>(new Set());

	const fetchIncidents = useCallback(async () => {
		try {
			const result = await csrfFetch<{ announcements: ActiveAnnouncement[] }>("/api/announcements");
			const active = (result.announcements ?? []).filter(
				(a) => INCIDENT_LEVELS.has(a.level) && (!a.expiresAt || new Date(a.expiresAt) > new Date()),
			);
			setIncidents(active);
		} catch {
			// non-critical UI
		}
	}, []);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void fetchIncidents();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [fetchIncidents]);

	if (incidents.length === 0) return null;
	const visible = incidents.filter((i) => !dismissed.has(i.id));
	if (visible.length === 0) return null;

	function levelColor(level: string) {
		if (level === "incident") return "border-[var(--warning-border)] bg-[var(--warning-bg)]";
		if (level === "maintenance") return "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10";
		return "border-[var(--border)] bg-[var(--surface-elevated)]";
	}

	function levelLabel(level: string) {
		if (level === "incident") return t("healthPage.incident.level.incident");
		if (level === "maintenance") return t("healthPage.incident.level.maintenance");
		return level;
	}

	return (
		<section className="space-y-3" aria-label={t("healthPage.activeIncidentsAria")}>
			{visible.map((item) => (
				<div key={item.id} className={`rounded-xl border p-4 ${levelColor(item.level)}`}>
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<span className="text-xs font-medium text-[var(--text-primary)]">{levelLabel(item.level)}</span>
								<h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{item.title}</h3>
							</div>
							<p className="mt-1.5 line-clamp-3 text-sm leading-6 text-[var(--text-secondary)]">{item.body}</p>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								{t("healthPage.incident.started").replace("{time}", new Date(item.startsAt).toLocaleString(toDateLocale(locale)))}
								{item.expiresAt ? ` · ${t("healthPage.incident.expectedEnd").replace("{time}", new Date(item.expiresAt).toLocaleString(toDateLocale(locale)))}` : ""}
							</p>
						</div>
						<button
							type="button"
							aria-label={t("healthPage.incident.dismissAria").replace("{title}", item.title)}
							onClick={() => setDismissed((prev) => new Set(prev).add(item.id))}
							className="shrink-0 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
						>
							✕
						</button>
					</div>
				</div>
			))}
		</section>
	);
}
