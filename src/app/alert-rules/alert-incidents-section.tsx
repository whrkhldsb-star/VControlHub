"use client";

import { ActionButton } from "@/components/action-button";
import { useI18n } from "@/lib/i18n/use-locale";

import type { AlertIncident } from "./alert-rule-types";

type Props = {
	incidents: AlertIncident[];
	incidentsLoading: boolean;
	busyAction: string | null;
	loadIncidents: () => Promise<void>;
	ackIncident: (incidentId: string) => Promise<void>;
};

export function AlertIncidentsSection({
	incidents,
	incidentsLoading,
	busyAction,
	loadIncidents,
	ackIncident,
}: Props) {
	const { t } = useI18n();

	return (
		<section className="mb-6 space-y-3" aria-label={t("alertRulesPage.incidents.title")}>
			<div className="flex items-center justify-between gap-2">
				<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("alertRulesPage.incidents.title")}</h2>
				<ActionButton variant="secondary"
					onClick={() => void loadIncidents()} className="!min-h-11 !px-3 !text-xs"
				>
					{incidentsLoading ? "…" : t("alertRulesPage.incidents.refresh")}
				</ActionButton>
			</div>
			{incidents.filter((i) => i.status !== "RESOLVED").length === 0 ? (
				<p className="text-xs text-[var(--text-muted)]">{t("alertRulesPage.incidents.empty")} ({incidents.filter((i) => i.status === "RESOLVED").length} {t("alertRulesPage.incidents.resolved")})</p>
			) : (
				<div className="space-y-2">
					{incidents
						.filter((i) => i.status !== "RESOLVED")
						.slice(0, 20)
						.map((incident) => (
							<div
								key={incident.id}
								className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3 sm:flex-row sm:items-center sm:justify-between"
							>
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<span className="rounded-full bg-[var(--danger-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--danger)]">
											{t("alertRulesPage.incidents.level", { level: incident.level })}
										</span>
										<span className="text-sm font-medium text-[var(--text-primary)]">{incident.title}</span>
										<span className="text-[10px] text-[var(--text-muted)]">
											{incident.status === "ACKNOWLEDGED"
												? t("alertRulesPage.incidents.acked")
												: t("alertRulesPage.incidents.open")}
										</span>
									</div>
									<p className="mt-1 truncate text-xs text-[var(--text-secondary)]">{incident.message}</p>
								</div>
								{incident.status === "OPEN" && (
									<ActionButton variant="primary"
										disabled={busyAction === `ack:${incident.id}`}
										onClick={() => void ackIncident(incident.id)} className="!min-h-11 !px-3 !text-xs !font-semibold disabled:opacity-50"
									>
										{t("alertRulesPage.incidents.ack")}
									</ActionButton>
								)}
							</div>
						))}
				</div>
			)}
		</section>
	);
}
