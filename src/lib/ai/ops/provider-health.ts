import { z } from "zod";
import { AiProviderHttpError } from "../provider-errors";

const providerHealthSchema = z.object({
	state: z.enum(["success", "failed", "cooldown", "unavailable"]),
	configurationVersion: z.string().max(64),
	consecutiveFailures: z.number().int().min(0).max(100),
	failureKind: z.enum(["access", "quota", "rate_limit", "upstream", "request", "transport", "configuration"]).nullable(),
	httpStatus: z.number().int().min(400).max(599).nullable(),
	retryAt: z.iso.datetime().nullable(),
});
export type AiOpsProviderHealth = z.infer<typeof providerHealthSchema>;

export function parseProviderHealth(value: unknown): AiOpsProviderHealth | null {
	const parsed = providerHealthSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

export function failedProviderHealth(error: unknown, configurationVersion: string, previous: AiOpsProviderHealth | null, now = Date.now()): AiOpsProviderHealth {
	const consecutiveFailures = Math.min(100, (previous?.consecutiveFailures ?? 0) + 1);
	const typed = error instanceof AiProviderHttpError ? error : null;
	const failureKind = typed?.failureKind ?? "transport";
	// Account/quota failures need operator intervention. Transient failures
	// back off exponentially, with Retry-After respected and a 24-hour cap.
	const base = ["access", "quota", "request"].includes(failureKind) ? 24 * 60 * 60 * 1000 : Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.min(consecutiveFailures - 1, 6));
	const delay = Math.min(24 * 60 * 60 * 1000, Math.max(base, typed?.retryAfterMs ?? 0));
	return { state: "failed", configurationVersion, consecutiveFailures, failureKind, httpStatus: typed?.status ?? null, retryAt: new Date(now + delay).toISOString() };
}
