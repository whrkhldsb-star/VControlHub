import { registerServerSentry } from "@/lib/monitoring/sentry.server";

export async function register() {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		registerServerSentry();
	}
}
