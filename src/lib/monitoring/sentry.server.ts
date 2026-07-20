import { config } from "@/lib/config/env";
import * as Sentry from "@sentry/nextjs";

export function registerServerSentry() {
	if (process.env.NEXT_RUNTIME === "nodejs" && config.sentry.dsn) {
		Sentry.init({
			dsn: config.sentry.dsn,
			environment: config.nodeEnv,
			release: config.sentry.release,
			tracesSampleRate: config.sentry.tracesSampleRate,
			replaysSessionSampleRate: 0,
			replaysOnErrorSampleRate: config.sentry.replaysOnErrorSampleRate,
		});
	}
}
