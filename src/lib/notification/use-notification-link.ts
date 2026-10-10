"use client";

import { useCallback, type MouseEvent } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useSessionGate } from "@/lib/auth/session-context";
import { getSafeNotificationActionUrl } from "./action-url";

type LinkedNotification = { teamId?: string | null; actionUrl: string | null };

/**
 * Administrators receive notifications from every customer, while their pages
 * follow the selected customer. Opening a notification from another customer
 * first switches to that customer, so its link does not land on "not found".
 * Customer accounts only ever see their own customer: links open as usual.
 */
export function useNotificationLink() {
	const gate = useSessionGate();
	const isAdmin = gate.roles.includes("admin");
	const currentTeamId = gate.currentTeamId ?? null;

	const onOpen = useCallback((notification: LinkedNotification) => (event: MouseEvent<HTMLAnchorElement>) => {
		const teamId = notification.teamId;
		// "All customers" and the matching customer already show the target.
		if (!isAdmin || !teamId || !currentTeamId || teamId === currentTeamId) return;
		event.preventDefault();
		const href = getSafeNotificationActionUrl(notification.actionUrl);
		void csrfFetch("/api/teams/switch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ teamId }),
		})
			.catch(() => undefined)
			// Every page follows the selected customer: load the target afresh.
			.then(() => window.location.assign(href));
	}, [isAdmin, currentTeamId]);

	return { showCustomer: isAdmin, onOpen };
}
