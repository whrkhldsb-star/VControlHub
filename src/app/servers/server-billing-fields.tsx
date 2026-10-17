"use client";

import { useId } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { TRAFFIC_QUOTA_MODES } from "@/lib/public-status/billing";
import type { ServerBillingFormValues } from "@/lib/server/billing-form";
import { UI_INPUT } from "@/lib/ui/classes";

/** Rental expiry and monthly traffic allowance; shared by the create and edit forms. */
export function ServerBillingFields({ defaults, compact = false }: { defaults?: ServerBillingFormValues; compact?: boolean }) {
	const { t } = useI18n();
	const id = useId();
	return (
		<div className="space-y-2">
			<div className={compact ? "grid gap-2 sm:grid-cols-[1fr_1fr_120px]" : "grid gap-3 sm:grid-cols-[1fr_1fr_140px]"}>
				<div className="space-y-1.5">
					<label className="ui-label" htmlFor={`${id}-expires`}>{t("serversPage.billing.expiresOn")}</label>
					<input id={`${id}-expires`} name="expiresOn" type="date" defaultValue={defaults?.expiresOn ?? ""} className={UI_INPUT} />
				</div>
				<div className="space-y-1.5">
					<label className="ui-label" htmlFor={`${id}-quota`}>{t("serversPage.billing.trafficQuotaGb")}</label>
					<input
						id={`${id}-quota`}
						name="trafficQuotaGb"
						type="text"
						inputMode="decimal"
						placeholder={t("serversPage.billing.unlimited")}
						defaultValue={defaults?.trafficQuotaGb ?? ""}
						className={UI_INPUT}
					/>
				</div>
				<div className="space-y-1.5">
					<label className="ui-label" htmlFor={`${id}-mode`}>{t("serversPage.billing.trafficQuotaMode")}</label>
					<select id={`${id}-mode`} name="trafficQuotaMode" defaultValue={defaults?.trafficQuotaMode ?? "sum"} className={UI_INPUT}>
						{TRAFFIC_QUOTA_MODES.map((mode) => (
							<option key={mode} value={mode}>{t(`serversPage.billing.mode.${mode}`)}</option>
						))}
					</select>
				</div>
			</div>
			<p className="text-xs text-[var(--text-muted)]">{t("serversPage.billing.hint")}</p>
		</div>
	);
}
