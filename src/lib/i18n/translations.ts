/** Complete server translation map, including API and background-service copy. */
import { browserTranslations } from "./browser-translations";
import { zh as aiChatApiZh, en as aiChatApiEn } from "./dictionaries/ai-chat-api";
import { zh as backendServicesZh, en as backendServicesEn } from "./dictionaries/backend-services";
import { zh as downloadsApiZh, en as downloadsApiEn } from "./dictionaries/downloads-api";
import { zh as openApiSpecZh, en as openApiSpecEn } from "./dictionaries/openapi-spec";
import { zh as serversDetectOsApiZh, en as serversDetectOsApiEn } from "./dictionaries/servers-detect-os-api";
import { zh as serversFileProxyApiZh, en as serversFileProxyApiEn } from "./dictionaries/servers-file-proxy-api";
import { zh as serversReloadApiZh, en as serversReloadApiEn } from "./dictionaries/servers-reload-api";
import { zh as shareTokenApiZh, en as shareTokenApiEn } from "./dictionaries/share-token-api";
import { zh as vpsBackupApiZh, en as vpsBackupApiEn } from "./dictionaries/vps-backup-api";
import { interpolate, type Locale } from "./core";

export const translations: Record<Locale, Record<string, string>> = {
	zh: {
		...browserTranslations.zh,
		...aiChatApiZh,
		...backendServicesZh,
		...downloadsApiZh,
		...openApiSpecZh,
		...serversDetectOsApiZh,
		...serversFileProxyApiZh,
		...serversReloadApiZh,
		...shareTokenApiZh,
		...vpsBackupApiZh,
	},
	en: {
		...browserTranslations.en,
		...aiChatApiEn,
		...backendServicesEn,
		...downloadsApiEn,
		...openApiSpecEn,
		...serversDetectOsApiEn,
		...serversFileProxyApiEn,
		...serversReloadApiEn,
		...shareTokenApiEn,
		...vpsBackupApiEn,
	},
};

export function t(
	key: string,
	localeOrVars?: Locale | Record<string, string | number>,
	maybeVars?: Record<string, string | number>,
): string {
	const locale: Locale = typeof localeOrVars === "string" ? localeOrVars : "zh";
	const vars = typeof localeOrVars === "object" ? localeOrVars : maybeVars;
	return interpolate(translations[locale]?.[key] || key, vars);
}

export function getAllTranslations(locale: Locale): Record<string, string> {
	return translations[locale] || translations.zh;
}

export async function getServerLocale(): Promise<Locale> {
	try {
		const { cookies } = await import("next/headers");
		const store = await cookies();
		return store.get("vps-locale")?.value === "en" ? "en" : "zh";
	} catch {
		return "zh";
	}
}

export { interpolate } from "./core";
export type { Locale, TFn } from "./core";
