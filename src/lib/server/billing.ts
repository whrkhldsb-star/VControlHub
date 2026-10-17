/**
 * Rental expiry and monthly traffic allowance of a server — the facts Komari
 * shows as "23 days left" and a quota bar. Kept apart from the profile
 * create/update flow: the server actions validate the three fields first,
 * then store them once the profile itself was saved. Edits use the same
 * scope as editing the profile.
 */
import { serverProfileTeamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { zonedDateTimeToDate } from "@/lib/datetime/time-zone";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { isTrafficQuotaMode, type TrafficQuotaMode } from "@/lib/public-status/billing";
import { GIB } from "./billing-form";

/** 1 PiB: far above any VPS allowance, low enough to stay exact in a double. */
const MAX_QUOTA_BYTES = 1024 ** 5;

export type ServerBillingInput = {
	/** `YYYY-MM-DD` in the application time zone, or empty to clear. */
	expiresOn: string;
	/** Allowance in GiB, or empty for unlimited. */
	trafficQuotaGb: string;
	trafficQuotaMode: string;
};

export type ServerBillingValues = {
	expiresAt: Date | null;
	trafficQuotaBytes: bigint | null;
	trafficQuotaMode: TrafficQuotaMode;
};

/** The billing inputs of a server form; null when the form has none (nothing to change). */
export function billingInputFromForm(formData: FormData): ServerBillingInput | null {
	if (!formData.has("trafficQuotaMode")) return null;
	return {
		expiresOn: String(formData.get("expiresOn") ?? ""),
		trafficQuotaGb: String(formData.get("trafficQuotaGb") ?? ""),
		trafficQuotaMode: String(formData.get("trafficQuotaMode") ?? "sum"),
	};
}

export function normalizeServerBilling(input: ServerBillingInput): ServerBillingValues {
	const day = input.expiresOn.trim();
	let expiresAt: Date | null = null;
	if (day) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ValidationError(t("backend.server.billing.expiryInvalid"));
		try {
			// The whole chosen day counts: the rental ends at its last second.
			expiresAt = zonedDateTimeToDate(`${day}T23:59:59`);
		} catch {
			throw new ValidationError(t("backend.server.billing.expiryInvalid"));
		}
	}
	const quotaText = input.trafficQuotaGb.trim();
	let trafficQuotaBytes: bigint | null = null;
	if (quotaText) {
		const gib = Number(quotaText);
		if (!/^\d+(\.\d{1,3})?$/.test(quotaText) || !Number.isFinite(gib) || gib <= 0 || gib * GIB > MAX_QUOTA_BYTES) {
			throw new ValidationError(t("backend.server.billing.quotaInvalid"));
		}
		trafficQuotaBytes = BigInt(Math.round(gib * GIB));
	}
	return {
		expiresAt,
		trafficQuotaBytes,
		trafficQuotaMode: isTrafficQuotaMode(input.trafficQuotaMode) ? input.trafficQuotaMode : "sum",
	};
}

/** Store billing on a server this request just created. */
export async function saveNewServerBilling(serverId: string, values: ServerBillingValues): Promise<void> {
	await prisma.server.update({ where: { id: serverId }, data: values });
}

/** Store billing on an existing server the session may edit. */
export async function updateServerBilling(serverId: string, values: ServerBillingValues, session: TeamSession): Promise<void> {
	const server = await prisma.server.findFirst({ where: { AND: [{ id: serverId }, serverProfileTeamWhere(session)] }, select: { id: true } });
	if (!server) throw new NotFoundError(t("backend.server.nodeNotFound"));
	await prisma.server.update({ where: { id: serverId }, data: values });
}
