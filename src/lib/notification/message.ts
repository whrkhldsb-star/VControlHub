/**
 * Locale-independent notification copy. A notification row stores an event
 * code plus parameters next to the rendered fallback text, and is rendered in
 * the viewer's language when shown (see dictionaries/notification-messages).
 * Client-safe: no database or server-only imports.
 */
import { browserT } from "@/lib/i18n/browser-translations";
import type { Locale } from "@/lib/i18n/core";

export type NotificationParams = Record<string, string | number>;

export type NotificationMessageCode =
	| "commandPending"
	| "commandApproved"
	| "commandRejected"
	| "commandCompleted"
	| "commandFailed"
	| "commandCancelled"
	| "downloadCompleted"
	| "downloadFailed"
	| "downloadFailedWithReason"
	| "taskConsecutiveFailed"
	| "quickServiceInstalled"
	| "quickServiceInstallFailed"
	| "costBudgetAlert"
	| "ticketSlaEscalated"
	| "itsmFanOutFailed"
	| "alertTest"
	| "alertFired"
	| "alertOffline"
	| "alertResolved"
	| "alertBackOnline"
	| "alertEscalated";

export type NotificationMessage = { code: NotificationMessageCode; params?: NotificationParams };

type Translate = (key: string, vars?: NotificationParams) => string;

type LocalizableNotification = {
	title: string;
	message: string;
	messageCode?: string | null;
	messageParams?: unknown;
};

function isParams(value: unknown): value is NotificationParams {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		&& Object.values(value).every((v) => typeof v === "string" || typeof v === "number");
}

/** Resolve `<name>Key` params into `{name}` labels; null if a key is unknown. */
function resolveParams(params: NotificationParams, translate: Translate): NotificationParams | null {
	const vars: NotificationParams = {};
	for (const [name, value] of Object.entries(params)) {
		if (name.endsWith("Key") && typeof value === "string") {
			const label = translate(value);
			if (label === value) return null;
			vars[name.slice(0, -3)] = label;
		} else {
			vars[name] = value;
		}
	}
	return vars;
}

/** Title and message for `code`, or null for each part the dictionary lacks. */
function renderParts(code: string, params: NotificationParams, translate: Translate) {
	const vars = resolveParams(params, translate);
	if (!vars) return { title: null, message: null };
	const part = (field: "title" | "message") => {
		const key = `notification.${code}.${field}`;
		return translate(key) === key ? null : translate(key, vars);
	};
	return { title: part("title"), message: part("message") };
}

/** Stored text for a new row, in the default locale. */
export function renderNotificationFallback(notice: NotificationMessage, locale: Locale = "zh") {
	const parts = renderParts(notice.code, notice.params ?? {}, (key, vars) => browserT(key, locale, vars));
	return { title: parts.title ?? notice.code, message: parts.message ?? "" };
}

/** Title and message in the viewer's language, falling back to the stored text. */
export function localizeNotification(notification: LocalizableNotification, translate: Translate) {
	const { messageCode, messageParams } = notification;
	if (!messageCode) return { title: notification.title, message: notification.message };
	const parts = renderParts(messageCode, isParams(messageParams) ? messageParams : {}, translate);
	return { title: parts.title ?? notification.title, message: parts.message ?? notification.message };
}
