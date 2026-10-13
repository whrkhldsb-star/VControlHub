import type { Locale } from "./core";

export async function getServerLocale(): Promise<Locale> {
	try {
		const { cookies } = await import("next/headers");
		const store = await cookies();
		const cookie = store.get("vps-locale")?.value;
		if (cookie === "en" || cookie === "zh") return cookie;
		const { getPlatformDefaults } = await import("@/lib/settings/platform-defaults");
		return (await getPlatformDefaults()).locale;
	} catch {
		return "zh";
	}
}
