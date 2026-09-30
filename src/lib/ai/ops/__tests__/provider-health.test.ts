import { expect, it } from "vitest";
import { AiProviderHttpError } from "../../provider-errors";
import { failedProviderHealth, parseProviderHealth } from "../provider-health";

it("distinguishes quota/access failures from transient errors without retaining upstream text", () => {
	const error = new AiProviderHttpError("rejected", 429, "insufficient_quota secret-key", null);
	const result = failedProviderHealth(error, "v1", null, 0);
	expect(result.failureKind).toBe("quota");
	expect(result.retryAt).toBe(new Date(24 * 60 * 60 * 1000).toISOString());
	expect(JSON.stringify(result)).not.toContain("secret-key");
});

it("backs off transient failures exponentially and respects Retry-After", () => {
	const first = failedProviderHealth(new Error("network"), "v1", null, 0);
	expect(first.retryAt).toBe(new Date(60_000).toISOString());
	const second = failedProviderHealth(new Error("network"), "v1", first, 0);
	expect(second.retryAt).toBe(new Date(120_000).toISOString());
	const limited = failedProviderHealth(new AiProviderHttpError("rate", 429, "rate limit", "600"), "v1", null, 0);
	expect(limited.failureKind).toBe("rate_limit");
	expect(limited.retryAt).toBe(new Date(600_000).toISOString());
});

it("rejects corrupted persisted retry metadata", () => {
	expect(parseProviderHealth({ state: "failed", retryAt: "forever", consecutiveFailures: -1 })).toBeNull();
	expect(parseProviderHealth(null)).toBeNull();
});
