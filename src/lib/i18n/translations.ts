/**
 * Simple i18n system — Chinese/English translations.
 * Uses React context + localStorage persistence.
 * No external deps — lightweight alternative to next-intl.
 */

export type Locale = "zh" | "en";

/**
 * Runtime translations map — built by spreading every dictionary under
 * `./dictionaries/*`. Keep this file as the aggregation entry point;
 * individual keys live in their domain files for easier editing.
 */


import { zh as aiZh, en as aiEn } from "./dictionaries/ai";
import { zh as alertrulespageZh, en as alertrulespageEn } from "./dictionaries/alert-rules-page";
import { zh as announcementspageZh, en as announcementspageEn } from "./dictionaries/announcements-page";
import { zh as apitokenspageZh, en as apitokenspageEn } from "./dictionaries/api-tokens-page";
import { zh as auditZh, en as auditEn } from "./dictionaries/audit";
import { zh as authZh, en as authEn } from "./dictionaries/auth";
import { zh as commonZh, en as commonEn } from "./dictionaries/common";
import { zh as dashboardZh, en as dashboardEn } from "./dictionaries/dashboard";
import { zh as dockerZh, en as dockerEn } from "./dictionaries/docker";
import { zh as dockerpageZh, en as dockerpageEn } from "./dictionaries/docker-page";
import { zh as errorZh, en as errorEn } from "./dictionaries/error";
import { zh as imagebedZh, en as imagebedEn } from "./dictionaries/image-bed";
import { zh as imagebedpageZh, en as imagebedpageEn } from "./dictionaries/image-bed-page";
import { zh as loginZh, en as loginEn } from "./dictionaries/login";
import { zh as mediaitemcardZh, en as mediaitemcardEn } from "./dictionaries/media-item-card";
import { zh as mediapageZh, en as mediapageEn } from "./dictionaries/media-page";
import { zh as mediascanbuttonZh, en as mediascanbuttonEn } from "./dictionaries/media-scan-button";
import { zh as mediauploadpanelZh, en as mediauploadpanelEn } from "./dictionaries/media-upload-panel";
import { zh as monitoringZh, en as monitoringEn } from "./dictionaries/monitoring";
import { zh as navZh, en as navEn } from "./dictionaries/nav";
import { zh as notfoundZh, en as notfoundEn } from "./dictionaries/not-found";
import { zh as notificationspageZh, en as notificationspageEn } from "./dictionaries/notifications-page";
import { zh as operationtasksZh, en as operationtasksEn } from "./dictionaries/operation-tasks";
import { zh as preferencespageZh, en as preferencespageEn } from "./dictionaries/preferences-page";
import { zh as qareportspageZh, en as qareportspageEn } from "./dictionaries/qa-reports-page";
import { zh as requestspageZh, en as requestspageEn } from "./dictionaries/requests-page";
import { zh as scheduledtasksZh, en as scheduledtasksEn } from "./dictionaries/scheduled-tasks";
import { zh as searchZh, en as searchEn } from "./dictionaries/search";
import { zh as serversZh, en as serversEn } from "./dictionaries/servers";
import { zh as serverspageZh, en as serverspageEn } from "./dictionaries/servers-page";
import { zh as sharesZh, en as sharesEn } from "./dictionaries/shares";
import { zh as statuspageZh, en as statuspageEn } from "./dictionaries/status-page";
import { zh as templatespageZh, en as templatespageEn } from "./dictionaries/templates-page";
import { zh as textpreviewZh, en as textpreviewEn } from "./dictionaries/text-preview";
import { zh as themeZh, en as themeEn } from "./dictionaries/theme";
import { zh as ticketsdetailZh, en as ticketsdetailEn } from "./dictionaries/tickets-detail";
import { zh as ticketspageZh, en as ticketspageEn } from "./dictionaries/tickets-page";
import { zh as trafficpageZh, en as trafficpageEn } from "./dictionaries/traffic-page";
import { zh as usersZh, en as usersEn } from "./dictionaries/users";
import { zh as userspageZh, en as userspageEn } from "./dictionaries/users-page";
import { zh as userspermZh, en as userspermEn } from "./dictionaries/users-perm";

const zh: Record<string, string> = {
	...aiZh,
	...alertrulespageZh,
	...announcementspageZh,
	...apitokenspageZh,
	...auditZh,
	...authZh,
	...commonZh,
	...dashboardZh,
	...dockerZh,
	...dockerpageZh,
	...errorZh,
	...imagebedZh,
	...imagebedpageZh,
	...loginZh,
	...mediaitemcardZh,
	...mediapageZh,
	...mediascanbuttonZh,
	...mediauploadpanelZh,
	...monitoringZh,
	...navZh,
	...notfoundZh,
	...notificationspageZh,
	...operationtasksZh,
	...preferencespageZh,
	...qareportspageZh,
	...requestspageZh,
	...scheduledtasksZh,
	...searchZh,
	...serversZh,
	...serverspageZh,
	...sharesZh,
	...statuspageZh,
	...templatespageZh,
	...textpreviewZh,
	...themeZh,
	...ticketsdetailZh,
	...ticketspageZh,
	...trafficpageZh,
	...usersZh,
	...userspageZh,
	...userspermZh,
};

const en: Record<string, string> = {
	...aiEn,
	...alertrulespageEn,
	...announcementspageEn,
	...apitokenspageEn,
	...auditEn,
	...authEn,
	...commonEn,
	...dashboardEn,
	...dockerEn,
	...dockerpageEn,
	...errorEn,
	...imagebedEn,
	...imagebedpageEn,
	...loginEn,
	...mediaitemcardEn,
	...mediapageEn,
	...mediascanbuttonEn,
	...mediauploadpanelEn,
	...monitoringEn,
	...navEn,
	...notfoundEn,
	...notificationspageEn,
	...operationtasksEn,
	...preferencespageEn,
	...qareportspageEn,
	...requestspageEn,
	...scheduledtasksEn,
	...searchEn,
	...serversEn,
	...serverspageEn,
	...sharesEn,
	...statuspageEn,
	...templatespageEn,
	...textpreviewEn,
	...themeEn,
	...ticketsdetailEn,
	...ticketspageEn,
	...trafficpageEn,
	...usersEn,
	...userspageEn,
	...userspermEn,
};

export const translations: Record<Locale, Record<string, string>> = {
	zh,
	en,
};


export function t(key: string, locale: Locale = "zh"): string {
	return translations[locale]?.[key] || key;
}

export function getAllTranslations(locale: Locale): Record<string, string> {
	return translations[locale] || translations.zh;
}

/**
 * Server-side locale resolution: reads the `vps-locale` cookie set by the
 * client-side i18n switcher. Returns "zh" when absent or invalid.
 *
 * Use in server components and route handlers that need to render translated
 * text. Layout already wires the same value into I18nProvider for hydration,
 * so a single call here keeps server output consistent with the client tree.
 */
export async function getServerLocale(): Promise<Locale> {
	const { cookies } = await import("next/headers");
	const store = await cookies();
	const value = store.get("vps-locale")?.value;
	return value === "en" ? "en" : "zh";
}
