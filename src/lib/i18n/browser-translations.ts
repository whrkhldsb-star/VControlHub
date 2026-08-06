/** Translation resources that are safe and useful in the browser bundle. */
import { zh as accountPasswordPageZh, en as accountPasswordPageEn } from "./dictionaries/account-password-page";
import { zh as aiZh, en as aiEn } from "./dictionaries/ai";
import { zh as aiOpsPageZh, en as aiOpsPageEn } from "./dictionaries/ai-ops-page";
import { zh as alertRulesPageZh, en as alertRulesPageEn } from "./dictionaries/alert-rules-page";
import { zh as apiDocsPageZh, en as apiDocsPageEn } from "./dictionaries/api-docs-page";
import { zh as archivePreviewZh, en as archivePreviewEn } from "./dictionaries/archive-preview";
import { zh as announcementsPageZh, en as announcementsPageEn } from "./dictionaries/announcements-page";
import { zh as apiTokensPageZh, en as apiTokensPageEn } from "./dictionaries/api-tokens-page";
import { zh as auditZh, en as auditEn } from "./dictionaries/audit";
import { zh as authZh, en as authEn } from "./dictionaries/auth";
import { zh as backupsPageZh, en as backupsPageEn } from "./dictionaries/backups-page";
import { zh as downloadsPageZh, en as downloadsPageEn } from "./dictionaries/downloads-page";
import { zh as apiCommonZh, en as apiCommonEn } from "./dictionaries/api-common";
import { zh as settingsPageZh, en as settingsPageEn } from "./dictionaries/settings-page";
import { zh as fileDetailPanelZh, en as fileDetailPanelEn } from "./dictionaries/file-detail-panel";
import { zh as fileVersionHistoryZh, en as fileVersionHistoryEn } from "./dictionaries/file-version-history";
import { zh as filesPageZh, en as filesPageEn } from "./dictionaries/files-page";
import { zh as deploymentsPageZh, en as deploymentsPageEn } from "./dictionaries/deployments-page";
import { zh as commonZh, en as commonEn } from "./dictionaries/common";
import { zh as costPageZh, en as costPageEn } from "./dictionaries/cost-page";
import { zh as csvPreviewZh, en as csvPreviewEn } from "./dictionaries/csv-preview";
import { zh as dashboardZh, en as dashboardEn } from "./dictionaries/dashboard";
import { zh as dockerZh, en as dockerEn } from "./dictionaries/docker";
import { zh as errorZh, en as errorEn } from "./dictionaries/error";
import { zh as fileUploadDropzoneZh, en as fileUploadDropzoneEn } from "./dictionaries/file-upload-dropzone";
import { zh as healthPageZh, en as healthPageEn } from "./dictionaries/health-page";
import { zh as vpsStatusZh, en as vpsStatusEn } from "./dictionaries/vps-status-page";
import { zh as knowledgePageZh, en as knowledgePageEn } from "./dictionaries/knowledge-page";
import { zh as imageBedZh, en as imageBedEn } from "./dictionaries/image-bed";
import { zh as imageBedPageZh, en as imageBedPageEn } from "./dictionaries/image-bed-page";
import { zh as languageToggleZh, en as languageToggleEn } from "./dictionaries/language-toggle";
import { zh as loginZh, en as loginEn } from "./dictionaries/login";
import { zh as markdownPreviewZh, en as markdownPreviewEn } from "./dictionaries/markdown-preview";
import { zh as mediaItemCardZh, en as mediaItemCardEn } from "./dictionaries/media-item-card";
import { zh as mediaPageZh, en as mediaPageEn } from "./dictionaries/media-page";
import { zh as mediaPreviewZh, en as mediaPreviewEn } from "./dictionaries/media-preview";
import { zh as mediaScanButtonZh, en as mediaScanButtonEn } from "./dictionaries/media-scan-button";
import { zh as mediaUploadPanelZh, en as mediaUploadPanelEn } from "./dictionaries/media-upload-panel";
import { zh as monitoringZh, en as monitoringEn } from "./dictionaries/monitoring";
import { zh as navZh, en as navEn } from "./dictionaries/nav";
import { zh as notFoundZh, en as notFoundEn } from "./dictionaries/not-found";
import { zh as notificationsPageZh, en as notificationsPageEn } from "./dictionaries/notifications-page";
import { zh as officePreviewZh, en as officePreviewEn } from "./dictionaries/office-preview";
import { zh as operationTasksZh, en as operationTasksEn } from "./dictionaries/operation-tasks";
import { zh as preferencesPageZh, en as preferencesPageEn } from "./dictionaries/preferences-page";
import { zh as playbooksPageZh, en as playbooksPageEn } from "./dictionaries/playbooks-page";
import { zh as pwaZh, en as pwaEn } from "./dictionaries/pwa";
import { zh as quickServicesZh, en as quickServicesEn } from "./dictionaries/quick-services";
import { zh as recycleBinSectionZh, en as recycleBinSectionEn } from "./dictionaries/recycle-bin-section";
import { zh as requestsPageZh, en as requestsPageEn } from "./dictionaries/requests-page";
import { zh as scheduledTasksZh, en as scheduledTasksEn } from "./dictionaries/scheduled-tasks";
import { zh as searchZh, en as searchEn } from "./dictionaries/search";
import { zh as serversZh, en as serversEn } from "./dictionaries/servers";
import { zh as sharePageZh, en as sharePageEn } from "./dictionaries/share-page";
import { zh as sharesZh, en as sharesEn } from "./dictionaries/shares";
import { zh as snippetsPageZh, en as snippetsPageEn } from "./dictionaries/snippets-page";
import { zh as sshTerminalModalZh, en as sshTerminalModalEn } from "./dictionaries/ssh-terminal-modal";
import { zh as statusPageZh, en as statusPageEn } from "./dictionaries/status-page";
import { zh as templatesPageZh, en as templatesPageEn } from "./dictionaries/templates-page";
import { zh as textPreviewZh, en as textPreviewEn } from "./dictionaries/text-preview";
import { zh as themeZh, en as themeEn } from "./dictionaries/theme";
import { zh as ticketsDetailZh, en as ticketsDetailEn } from "./dictionaries/tickets-detail";
import { zh as ticketsPageZh, en as ticketsPageEn } from "./dictionaries/tickets-page";
import { zh as itsmPageZh, en as itsmPageEn } from "./dictionaries/itsm-page";
import { zh as trafficPageZh, en as trafficPageEn } from "./dictionaries/traffic-page";
import { zh as usersZh, en as usersEn } from "./dictionaries/users";
import { zh as usersPermZh, en as usersPermEn } from "./dictionaries/users-perm";
import { zh as storagePageZh, en as storagePageEn } from "./dictionaries/storage-page";
import { zh as systemConfigZh, en as systemConfigEn } from "./dictionaries/system-config";
import { interpolate, type Locale } from "./core";

const zh: Record<string, string> = {
	...accountPasswordPageZh, ...aiZh, ...aiOpsPageZh, ...alertRulesPageZh,
	...apiDocsPageZh, ...archivePreviewZh, ...announcementsPageZh, ...apiTokensPageZh,
	...auditZh, ...authZh, ...backupsPageZh, ...downloadsPageZh, ...apiCommonZh,
	...settingsPageZh, ...fileDetailPanelZh, ...fileVersionHistoryZh, ...filesPageZh,
	...deploymentsPageZh, ...commonZh, ...costPageZh, ...csvPreviewZh, ...dashboardZh,
	...dockerZh, ...errorZh, ...fileUploadDropzoneZh, ...healthPageZh, ...vpsStatusZh,
	...knowledgePageZh, ...imageBedZh, ...imageBedPageZh, ...languageToggleZh, ...loginZh,
	...markdownPreviewZh, ...mediaItemCardZh, ...mediaPageZh, ...mediaPreviewZh,
	...mediaScanButtonZh, ...mediaUploadPanelZh, ...monitoringZh, ...navZh, ...notFoundZh,
	...notificationsPageZh, ...officePreviewZh, ...operationTasksZh, ...preferencesPageZh,
	...playbooksPageZh, ...pwaZh, ...quickServicesZh, ...recycleBinSectionZh,
	...requestsPageZh, ...scheduledTasksZh, ...searchZh, ...serversZh, ...sharePageZh,
	...sharesZh, ...snippetsPageZh, ...sshTerminalModalZh, ...statusPageZh,
	...templatesPageZh, ...textPreviewZh, ...themeZh, ...ticketsDetailZh, ...ticketsPageZh,
	...itsmPageZh, ...trafficPageZh, ...usersZh, ...usersPermZh, ...storagePageZh,
	...systemConfigZh,
};

const en: Record<string, string> = {
	...accountPasswordPageEn, ...aiEn, ...aiOpsPageEn, ...alertRulesPageEn,
	...apiDocsPageEn, ...archivePreviewEn, ...announcementsPageEn, ...apiTokensPageEn,
	...auditEn, ...authEn, ...backupsPageEn, ...downloadsPageEn, ...apiCommonEn,
	...settingsPageEn, ...fileDetailPanelEn, ...fileVersionHistoryEn, ...filesPageEn,
	...deploymentsPageEn, ...commonEn, ...costPageEn, ...csvPreviewEn, ...dashboardEn,
	...dockerEn, ...errorEn, ...fileUploadDropzoneEn, ...healthPageEn, ...vpsStatusEn,
	...knowledgePageEn, ...imageBedEn, ...imageBedPageEn, ...languageToggleEn, ...loginEn,
	...markdownPreviewEn, ...mediaItemCardEn, ...mediaPageEn, ...mediaPreviewEn,
	...mediaScanButtonEn, ...mediaUploadPanelEn, ...monitoringEn, ...navEn, ...notFoundEn,
	...notificationsPageEn, ...officePreviewEn, ...operationTasksEn, ...preferencesPageEn,
	...playbooksPageEn, ...pwaEn, ...quickServicesEn, ...recycleBinSectionEn,
	...requestsPageEn, ...scheduledTasksEn, ...searchEn, ...serversEn, ...sharePageEn,
	...sharesEn, ...snippetsPageEn, ...sshTerminalModalEn, ...statusPageEn,
	...templatesPageEn, ...textPreviewEn, ...themeEn, ...ticketsDetailEn, ...ticketsPageEn,
	...itsmPageEn, ...trafficPageEn, ...usersEn, ...usersPermEn, ...storagePageEn,
	...systemConfigEn,
};

export const browserTranslations: Record<Locale, Record<string, string>> = { zh, en };

export function browserT(
	key: string,
	localeOrVars?: Locale | Record<string, string | number>,
	maybeVars?: Record<string, string | number>,
): string {
	const locale: Locale = typeof localeOrVars === "string" ? localeOrVars : "zh";
	const vars = typeof localeOrVars === "object" ? localeOrVars : maybeVars;
	return interpolate(browserTranslations[locale]?.[key] || key, vars);
}

export type { Locale } from "./core";
