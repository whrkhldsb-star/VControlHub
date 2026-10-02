"use client";

import { useState } from "react";

import { ActionButton } from "@/components/action-button";
import { RefreshCw } from "@/components/icons";
import { EmptyState, ListPanel, ListRow } from "@/components/page-shell";
import { StatusBadge } from "@/components/status-badge";
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
	// Unresolved incidents beyond the first 20 were previously unreachable:
	// no pagination, no ack button — alerts could be silently missed. "Show all"
	// expands the remaining ones so every incident stays actionable.
	const [showAll, setShowAll] = useState(false);
	const unresolved = incidents.filter((i) => i.status !== "RESOLVED");
	const visible = showAll ? unresolved : unresolved.slice(0, 20);

	const resolvedCount = incidents.length - unresolved.length;

	return (
		<section aria-label={t("alertRulesPage.incidents.title")}>
			<ListPanel
				title={t("alertRulesPage.incidents.title")}
				count={unresolved.length > 0 ? unresolved.length : undefined}
				actions={
					<ActionButton
						size="sm"
						variant="ghost"
						icon={<RefreshCw size={14} aria-hidden />}
						loading={incidentsLoading}
						onClick={() => void loadIncidents()}
					>
						{t("alertRulesPage.incidents.refresh")}
					</ActionButton>
				}
				empty={
					unresolved.length === 0 ? (
						<EmptyState>
							{t("alertRulesPage.incidents.empty")} ({resolvedCount} {t("alertRulesPage.incidents.resolved")})
						</EmptyState>
					) : undefined
				}
			>
				{visible.map((incident) => (
					<ListRow key={incident.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<StatusBadge tone={incident.status === "ACKNOWLEDGED" ? "warning" : "danger"}>
									{t("alertRulesPage.incidents.level", { level: incident.level })}
								</StatusBadge>
								<span className="text-sm font-medium text-[var(--text-primary)]">{incident.title}</span>
								<span className="text-xs text-[var(--text-muted)]">
									{incident.status === "ACKNOWLEDGED"
										? t("alertRulesPage.incidents.acked")
										: t("alertRulesPage.incidents.open")}
								</span>
							</div>
							<p className="mt-1 truncate text-xs text-[var(--text-secondary)]">{incident.message}</p>
						</div>
						{incident.status === "OPEN" ? (
							<ActionButton
								size="sm"
								variant="secondary"
								loading={busyAction === `ack:${incident.id}`}
								onClick={() => void ackIncident(incident.id)}
							>
								{t("alertRulesPage.incidents.ack")}
							</ActionButton>
						) : null}
					</ListRow>
				))}
				{!showAll && unresolved.length > 20 ? (
					<button
						type="button"
						onClick={() => setShowAll(true)}
						className="w-full px-4 py-2.5 text-center text-xs font-medium text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
					>
						{t("alertRulesPage.incidents.showAll", { count: unresolved.length - 20 })}
					</button>
				) : null}
			</ListPanel>
		</section>
	);
}
