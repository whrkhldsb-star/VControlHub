/**
 * Client-safe half of server billing: the DTO the server list carries and
 * the values the create/edit forms start from. Storage and validation live
 * in `./billing` (server only).
 */
import { appTimeZoneDateKey } from "@/lib/datetime/time-zone";
import { isTrafficQuotaMode, type TrafficQuotaMode } from "@/lib/public-status/billing";

export const GIB = 1024 ** 3;

export type ServerBillingDto = {
	/** End of the rental (ISO); null when not recorded. */
	expiresAt: string | null;
	/** Monthly allowance in bytes; null for unlimited. */
	trafficQuotaBytes: number | null;
	trafficQuotaMode: TrafficQuotaMode;
};

export type ServerBillingFormValues = {
	/** `YYYY-MM-DD` in the application time zone. */
	expiresOn: string;
	/** GiB, up to three decimals. */
	trafficQuotaGb: string;
	trafficQuotaMode: TrafficQuotaMode;
};

export function toServerBillingDto(server: {
	expiresAt?: Date | string | null;
	trafficQuotaBytes?: bigint | number | null;
	trafficQuotaMode?: string | null;
}): ServerBillingDto {
	const quota = server.trafficQuotaBytes === null || server.trafficQuotaBytes === undefined ? null : Number(server.trafficQuotaBytes);
	return {
		expiresAt: server.expiresAt ? new Date(server.expiresAt).toISOString() : null,
		trafficQuotaBytes: quota !== null && Number.isFinite(quota) && quota > 0 ? quota : null,
		trafficQuotaMode: isTrafficQuotaMode(server.trafficQuotaMode) ? server.trafficQuotaMode : "sum",
	};
}

export function billingFormValues(billing: ServerBillingDto | null | undefined): ServerBillingFormValues {
	return {
		expiresOn: billing?.expiresAt ? appTimeZoneDateKey(new Date(billing.expiresAt)) : "",
		trafficQuotaGb: billing?.trafficQuotaBytes ? String(Math.round((billing.trafficQuotaBytes / GIB) * 1000) / 1000) : "",
		trafficQuotaMode: billing?.trafficQuotaMode ?? "sum",
	};
}
