import type { ServerHealth } from "@/app/health/health-types";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Why a node could not be sampled, in the page's language. The collector's `error` is English ("Network
 * unreachable: ECONNREFUSED") and was shown as it was on a Chinese page; the reason itself (`errorDetail`) is
 * the system's own text and stays as it is.
 */
export function nodeErrorText(server: Pick<ServerHealth, "error" | "errorKind" | "errorDetail" | "latencyMs">, t: Translate): string | null {
	if (!server.error) return null;
	if (!server.errorKind) return server.error;
	return t(`vpsStatusPage.error.${server.errorKind}`, {
		detail: server.errorDetail || t("vpsStatusPage.error.unknownReason"),
		rtt: server.latencyMs ?? "?",
	});
}
