"use client";

import { useTransition } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";

import { LocalizedText } from "./localized-text";
import { LogOut } from "./icons";
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
			className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:opacity-60"
		>
			<LogOut size={18} aria-hidden="true" />
			<span><LocalizedText textKey="auth.logout" fallback="Sign out" /></span>
		</button>
	);
}
