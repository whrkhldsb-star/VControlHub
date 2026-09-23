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
import { zh as apiCopyZh, en as apiCopyEn } from "./dictionaries/api-copy";
import { zh as filesZh, en as filesEn } from "./dictionaries/files-page";
import { zh as storageZh, en as storageEn } from "./dictionaries/storage-page";
// Hardening-copy dictionaries — one per backend area so parallel work on
// separate domains never edits the same file.
import { zh as storageHardeningZh, en as storageHardeningEn } from "./dictionaries/storage-hardening-api";
import { zh as sshHardeningZh, en as sshHardeningEn } from "./dictionaries/ssh-hardening-api";
import { zh as opsHardeningZh, en as opsHardeningEn } from "./dictionaries/ops-hardening-api";
import { interpolate, type Locale } from "./core";

const fileActionCopy = (files: Record<string, string>, storage: Record<string, string>) => Object.fromEntries([
  ...Object.entries(files).filter(([key]) => key.startsWith("filesPage.move.")),
  ...Object.entries(storage).filter(([key]) => key.startsWith("storagePage.action.")),
]);

const zh: Record<string, string> = {
  ...fileActionCopy(filesZh, storageZh),
	...aiChatApiZh, ...apiCommonZh, ...backendServicesZh, ...downloadsApiZh,
	...downloadsPageZh, ...openApiSpecZh, ...serversDetectOsApiZh,
	...serversFileProxyApiZh, ...serversReloadApiZh, ...shareTokenApiZh,
	...vpsBackupApiZh,
	...storageHardeningZh, ...sshHardeningZh, ...opsHardeningZh,
	...apiCopyZh,
};

const en: Record<string, string> = {
  ...fileActionCopy(filesEn, storageEn),
	...aiChatApiEn, ...apiCommonEn, ...backendServicesEn, ...downloadsApiEn,
	...downloadsPageEn, ...openApiSpecEn, ...serversDetectOsApiEn,
	...serversFileProxyApiEn, ...serversReloadApiEn, ...shareTokenApiEn,
	...vpsBackupApiEn,
	...storageHardeningEn, ...sshHardeningEn, ...opsHardeningEn,
	...apiCopyEn,
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
