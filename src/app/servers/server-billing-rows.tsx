"use client";

import { useState } from "react";

import { appTimeZoneDateKey } from "@/lib/datetime/time-zone";
import { useI18n } from "@/lib/i18n/use-locale";
import { daysUntil } from "@/lib/public-status/billing";
import { formatIecBytes } from "@/lib/public-status/format";
import type { ServerBillingDto } from "@/lib/server/billing-form";
import { InfoRow } from "./server-overview-detail-sections";

/** Expiry and traffic allowance in the server details; nothing when neither is recorded. */
export function ServerBillingRows({ billing }: { billing: ServerBillingDto | null | undefined }) {
	const { t } = useI18n();
	// Days left as of opening the details; a day boundary passing while open is not worth a timer.
	const [nowMs] = useState(() => Date.now());
	if (!billing?.expiresAt && !billing?.trafficQuotaBytes) return null;
	let expiry: string | null = null;
	if (billing.expiresAt) {
		const date = appTimeZoneDateKey(new Date(billing.expiresAt));
		const days = daysUntil(billing.expiresAt, nowMs);
		expiry = days < 0
			? t("serversPage.billing.expiredAgo", { date, days: -days })
			: days === 0
				? t("serversPage.billing.expiresTodayRow", { date })
				: t("serversPage.billing.expiresIn", { date, days });
	}
	return (
		<>
			{expiry ? <InfoRow label={t("serversPage.billing.rowExpires")} value={expiry} /> : null}
			{billing.trafficQuotaBytes ? (
				<InfoRow
					label={t("serversPage.billing.rowQuota")}
					value={t("serversPage.billing.quotaValue", { amount: formatIecBytes(billing.trafficQuotaBytes), mode: t(`serversPage.billing.mode.${billing.trafficQuotaMode}`) })}
				/>
			) : null}
		</>
	);
}
