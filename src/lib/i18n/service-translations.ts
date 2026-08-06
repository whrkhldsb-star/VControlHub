/** Translation resources used by workers, SSH services, and backend modules. */
import { zh as aiChatApiZh, en as aiChatApiEn } from "./dictionaries/ai-chat-api";
import { zh as apiCommonZh, en as apiCommonEn } from "./dictionaries/api-common";
import { zh as backendServicesZh, en as backendServicesEn } from "./dictionaries/backend-services";
import { zh as downloadsApiZh, en as downloadsApiEn } from "./dictionaries/downloads-api";
import { zh as downloadsPageZh, en as downloadsPageEn } from "./dictionaries/downloads-page";
import { zh as openApiSpecZh, en as openApiSpecEn } from "./dictionaries/openapi-spec";
import { zh as serversDetectOsApiZh, en as serversDetectOsApiEn } from "./dictionaries/servers-detect-os-api";
import { zh as serversFileProxyApiZh, en as serversFileProxyApiEn } from "./dictionaries/servers-file-proxy-api";
import { zh as serversReloadApiZh, en as serversReloadApiEn } from "./dictionaries/servers-reload-api";
import { zh as shareTokenApiZh, en as shareTokenApiEn } from "./dictionaries/share-token-api";
import { zh as vpsBackupApiZh, en as vpsBackupApiEn } from "./dictionaries/vps-backup-api";
import { interpolate, type Locale } from "./core";

const zh: Record<string, string> = {
	...aiChatApiZh, ...apiCommonZh, ...backendServicesZh, ...downloadsApiZh,
	...downloadsPageZh, ...openApiSpecZh, ...serversDetectOsApiZh,
	...serversFileProxyApiZh, ...serversReloadApiZh, ...shareTokenApiZh,
	...vpsBackupApiZh,
};

const en: Record<string, string> = {
	...aiChatApiEn, ...apiCommonEn, ...backendServicesEn, ...downloadsApiEn,
	...downloadsPageEn, ...openApiSpecEn, ...serversDetectOsApiEn,
	...serversFileProxyApiEn, ...serversReloadApiEn, ...shareTokenApiEn,
	...vpsBackupApiEn,
};

export const serviceTranslations: Record<Locale, Record<string, string>> = { zh, en };

export function t(
	key: string,
	localeOrVars?: Locale | Record<string, string | number>,
	maybeVars?: Record<string, string | number>,
): string {
	const locale: Locale = typeof localeOrVars === "string" ? localeOrVars : "zh";
	const vars = typeof localeOrVars === "object" ? localeOrVars : maybeVars;
	return interpolate(serviceTranslations[locale]?.[key] || key, vars);
}

export type { Locale } from "./core";
