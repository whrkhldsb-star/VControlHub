"use client";

import { useTransition } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";

import { LocalizedText } from "./localized-text";
import { IconLogOut } from "./nav-icons";
import { useI18n } from "@/lib/i18n/use-locale";

export function SignOutButton() {
	const [pending, startTransition] = useTransition();
	const { t } = useI18n();

	function handleSignOut() {
		startTransition(async () => {
			try {
				await csrfFetch("/api/auth/signout", { method: "POST" });
			} catch {
				// fall through to redirect anyway — server clears cookie on success,
				// and on failure we still want the user to leave the authed surface.
			}
			// A full navigation clears in-memory authenticated UI and router caches.
			// eslint-disable-next-line @next/next/no-location-assign-relative-destination
			window.location.href = "/login";
		});
	}

	return (
		<button
			type="button"
			aria-label={t("auth.logout")}
			onClick={handleSignOut}
			disabled={pending}
			data-menu-item
			data-danger
		>
			<IconLogOut size={16} />
			<span><LocalizedText textKey="auth.logout" fallback="Sign out" /></span>
		</button>
	);
}
