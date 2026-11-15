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
import { zh as operationTasksZh, en as operationTasksEn } from "./dictionaries/operation-tasks";
// Hardening-copy dictionaries — one per backend area so parallel work on
// separate domains never edits the same file.
import { zh as storageHardeningZh, en as storageHardeningEn } from "./dictionaries/storage-hardening-api";
import { zh as sshHardeningZh, en as sshHardeningEn } from "./dictionaries/ssh-hardening-api";
import { zh as opsHardeningZh, en as opsHardeningEn } from "./dictionaries/ops-hardening-api";
import { zh as publicStatusApiZh, en as publicStatusApiEn } from "./dictionaries/public-status-api";
import { zh as storedSentencesZh, en as storedSentencesEn } from "./dictionaries/stored-sentences";
import { type Locale } from "./core";
import { currentCopyLocale } from "./api-copy";
import { makeT } from "./make-t";

const fileActionCopy = (files: Record<string, string>, storage: Record<string, string>) => Object.fromEntries([
	...Object.entries(files).filter(([key]) => key.startsWith("filesPage.move.")),
	...Object.entries(storage).filter(([key]) => key.startsWith("storagePage.action.")),
]);
// The task centre's failure summary names a job by its type, as the page's badges do.
const jobTypeCopy = (operationTasks: Record<string, string>) => Object.fromEntries(
	Object.entries(operationTasks).filter(([key]) => key.startsWith("operationTasks.jobType.")),
);

const zh: Record<string, string> = {
	...fileActionCopy(filesZh, storageZh),
	...jobTypeCopy(operationTasksZh),
	...aiChatApiZh, ...apiCommonZh, ...backendServicesZh, ...downloadsApiZh,
	...downloadsPageZh, ...openApiSpecZh, ...serversDetectOsApiZh,
	...serversFileProxyApiZh, ...serversReloadApiZh, ...shareTokenApiZh,
	...vpsBackupApiZh,
	...storageHardeningZh, ...sshHardeningZh, ...opsHardeningZh, ...publicStatusApiZh, ...storedSentencesZh,
	...apiCopyZh,
};

const en: Record<string, string> = {
	...fileActionCopy(filesEn, storageEn),
	...jobTypeCopy(operationTasksEn),
	...aiChatApiEn, ...apiCommonEn, ...backendServicesEn, ...downloadsApiEn,
	...downloadsPageEn, ...openApiSpecEn, ...serversDetectOsApiEn,
	...serversFileProxyApiEn, ...serversReloadApiEn, ...shareTokenApiEn,
	...vpsBackupApiEn,
	...storageHardeningEn, ...sshHardeningEn, ...opsHardeningEn, ...publicStatusApiEn, ...storedSentencesEn,
	...apiCopyEn,
};

export const serviceTranslations: Record<Locale, Record<string, string>> = { zh, en };

const translate = makeT(serviceTranslations);

/**
 * Backend copy. Inside an API request (withApiRoute) the default locale is the
 * request's, so a ValidationError thrown deep in a service reaches an English
 * UI in English. The worker and the terminal gateway have no request: they
 * speak the platform's default language (background-locale.ts), and "zh"
 * until that is known. An explicit locale argument always wins.
 */
export const t: typeof translate = (key, localeOrVars, maybeVars) =>
	typeof localeOrVars === "string"
		? translate(key, localeOrVars, maybeVars)
		: translate(key, currentCopyLocale() ?? "zh", localeOrVars ?? maybeVars);

export type { Locale } from "./core";
