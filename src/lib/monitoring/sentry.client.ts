import * as Sentry from "@sentry/nextjs";

export function registerClientSentry() {
	if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
		Sentry.init({
			dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
			environment: process.env.NODE_ENV ?? "development",
			release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.npm_package_version,
			tracesSampleRate: parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
			replaysSessionSampleRate: 0,
			replaysOnErrorSampleRate: parseFloat(process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ?? "1.0"),
		});
	}
}
