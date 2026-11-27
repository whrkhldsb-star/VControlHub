"use client";

import { createElement, useCallback, useState, type MouseEvent } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useSessionGate } from "@/lib/auth/session-context";
import {
	beginScopeSwitchRelease,
	endScopeSwitchRelease,
	formatActiveWorkSummary,
	getActiveWorkSnapshot,
} from "@/lib/forms/active-work-guard";
import { getSafeNotificationActionUrl } from "./action-url";

type LinkedNotification = {
	teamId?: string | null;
	teamName?: string | null;
	actionUrl: string | null;
};

type PendingNotificationSwitch = {
	teamId: string;
	href: string;
	label: string;
	summary: string;
};

/**
 * Administrators receive notifications from every customer, while their pages
 * follow the selected customer. Opening a notification from another customer
 * first switches to that customer, so its link does not land on "not found".
 * Customer accounts only ever see their own customer: links open as usual.
 */
export function useNotificationLink() {
	const gate = useSessionGate();
	const { addToast } = useToast();
	const { t } = useI18n();
	const isAdmin = gate.roles.includes("admin");
	const currentTeamId = gate.currentTeamId ?? null;
	const [pendingSwitch, setPendingSwitch] = useState<PendingNotificationSwitch | null>(null);
	const [switching, setSwitching] = useState(false);
	const [switchError, setSwitchError] = useState<string | null>(null);

	const runSwitch = useCallback(async (teamId: string, href: string, fromDialog: boolean) => {
		setSwitching(true);
		setSwitchError(null);
		beginScopeSwitchRelease();
		try {
			await csrfFetch("/api/teams/switch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ teamId }),
			});
			setPendingSwitch(null);
			// Every page follows the selected customer: force a full document reload
			// even when only the fragment differs so the new customer UI mounts cleanly.
			const targetUrl = new URL(href, window.location.href);
			const currentUrl = new URL(window.location.href);
			if (
				targetUrl.origin === currentUrl.origin &&
				targetUrl.pathname === currentUrl.pathname &&
				targetUrl.search === currentUrl.search
			) {
				window.location.replace(href);
				window.location.reload();
			} else {
				window.location.assign(href);
			}
		} catch (error) {
			endScopeSwitchRelease();
			const message = getErrorMessage(error, t("nav.customerSwitchFailed"));
			if (fromDialog) setSwitchError(message);
			else addToast("error", message);
		} finally {
			setSwitching(false);
		}
	}, [addToast, t]);

	const wouldSwitch = useCallback((notification: LinkedNotification) => {
		const teamId = notification.teamId;
		return Boolean(isAdmin && teamId && currentTeamId && teamId !== currentTeamId);
	}, [isAdmin, currentTeamId]);

	const onOpen = useCallback((notification: LinkedNotification) => (event: MouseEvent<HTMLAnchorElement>) => {
		const teamId = notification.teamId;
		// "All customers" and the matching customer already show the target.
		if (!isAdmin || !teamId || !currentTeamId || teamId === currentTeamId) return;
		event.preventDefault();
		const href = getSafeNotificationActionUrl(notification.actionUrl);
		const snapshot = getActiveWorkSnapshot();
		if (snapshot.hasAny) {
			setSwitchError(null);
			setPendingSwitch({
				teamId,
				href,
				label: notification.teamName || t("nav.customerLabel"),
				summary: formatActiveWorkSummary(snapshot, t),
			});
			return;
		}
		void runSwitch(teamId, href, false);
	}, [isAdmin, currentTeamId, runSwitch, t]);

	const switchDialog = createElement(ConfirmDialog, {
		open: pendingSwitch !== null,
		title: t("nav.customerSwitchConfirmTitle", { name: pendingSwitch?.label ?? "" }),
		description: pendingSwitch
			? t("nav.customerSwitchConfirmDesc", { name: pendingSwitch.label, items: pendingSwitch.summary })
			: undefined,
		cancelLabel: t("common.cancel"),
		confirmLabel: t("nav.customerSwitchConfirmButton"),
		busy: switching,
		error: switchError,
		closeOnBackdrop: false,
		onCancel: () => {
			if (switching) return;
			setPendingSwitch(null);
			setSwitchError(null);
		},
		onConfirm: () => {
			if (!pendingSwitch) return;
			void runSwitch(pendingSwitch.teamId, pendingSwitch.href, true);
		},
	});

	return { showCustomer: isAdmin, wouldSwitch, onOpen, switchDialog };
}
