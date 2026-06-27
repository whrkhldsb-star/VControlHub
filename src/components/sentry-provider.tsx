"use client";

import { useEffect } from "react";

/**
 * Lazy Sentry init on the client side.
 * If NEXT_PUBLIC_SENTRY_DSN is set, loads @sentry/nextjs and inits.
 * If not, this component is a no-op — no bundle cost from Sentry.
 */
export function SentryProvider() {
	useEffect(() => {
		if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
			import("@/lib/monitoring/sentry.client").then(({ registerClientSentry }) => {
				registerClientSentry();
			});
		}
	}, []);
	return null;
}
