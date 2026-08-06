import type { Locale } from "./core";

export async function getServerLocale(): Promise<Locale> {
	try {
		const { cookies } = await import("next/headers");
		const store = await cookies();
		return store.get("vps-locale")?.value === "en" ? "en" : "zh";
	} catch {
		return "zh";
	}
}
