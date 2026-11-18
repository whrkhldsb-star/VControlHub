import * as Sentry from "@sentry/node";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { config } from "@/lib/config/env";

export function registerServerSentry() {
	if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD || !config.sentry.dsn) return;

	// Next emits the incoming request span. Let Sentry instrument outgoing requests.
	process.env.NEXT_OTEL_FETCH_DISABLED = "1";
	Sentry.init({
		dsn: config.sentry.dsn,
		environment: config.nodeEnv,
		release: config.sentry.release,
		tracesSampleRate: config.sentry.tracesSampleRate,
		integrations: [Sentry.httpIntegration({ disableIncomingRequestSpans: true })],
	});
}
