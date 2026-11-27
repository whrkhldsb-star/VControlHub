"use client";

import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/ui-primitives";
import { StatusBadge } from "@/components/status-badge";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { formatDateTime } from "@/lib/datetime/format";
import { useI18n } from "@/lib/i18n/use-locale";
import { markdownExcerpt } from "@/lib/markdown/render-markdown";

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
	const [loadFailed, setLoadFailed] = useState(false);

	const fetchIncidents = useCallback(async () => {
		try {
			const result = await csrfFetch<{ announcements: ActiveAnnouncement[] }>("/api/announcements");
			const now = new Date();
			const active = (result.announcements ?? []).filter(
				(a) =>
					INCIDENT_LEVELS.has(a.level) &&
					new Date(a.startsAt) <= now &&
					(!a.expiresAt || new Date(a.expiresAt) > now),
			);
			setIncidents(active);
			setLoadFailed(false);
		} catch {
			setLoadFailed(true);
		}
	}, []);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void fetchIncidents();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [fetchIncidents]);

	const visible = incidents.filter((i) => !dismissed.has(i.id));
	if (visible.length === 0 && !loadFailed) return null;

	function levelLabel(level: string) {
		if (level === "incident") return t("healthPage.incident.level.incident");
		if (level === "maintenance") return t("healthPage.incident.level.maintenance");
		return level;
	}

	return (
		<section className="space-y-3" aria-label={t("healthPage.activeIncidentsAria")}>
			{loadFailed ? (
				<Notice
					tone="warning"
					compact
					action={{ label: t("common.retry"), onClick: () => void fetchIncidents() }}
				>
					{t("healthPage.incident.loadFailed")}
				</Notice>
			) : null}
			{visible.map((item) => (
				<Notice
					key={item.id}
					tone={item.level === "incident" ? "warning" : "info"}
					title={
						<span className="inline-flex flex-wrap items-center gap-2">
							<StatusBadge tone={item.level === "incident" ? "warning" : "info"} size="sm">
								{levelLabel(item.level)}
							</StatusBadge>
							<span className="break-words">{item.title}</span>
						</span>
					}
					onDismiss={() => setDismissed((prev) => new Set(prev).add(item.id))}
					dismissLabel={t("healthPage.incident.dismissAria", { title: item.title })}
				>
					<p className="text-sm leading-6 text-[var(--text-secondary)]">{markdownExcerpt(item.body)}</p>
					<p className="mt-1 text-xs text-[var(--text-muted)]">
						{t("healthPage.incident.started", { time: formatDateTime(item.startsAt, locale) })}
						{item.expiresAt ? ` · ${t("healthPage.incident.expectedEnd", { time: formatDateTime(item.expiresAt, locale) })}` : ""}
					</p>
				</Notice>
			))}
		</section>
	);
}
