"use client";

import { useState, useTransition } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";

import { LocalizedText } from "./localized-text";
import { IconLogOut } from "./nav-icons";
import { useI18n } from "@/lib/i18n/use-locale";

export function SignOutButton() {
	const [pending, startTransition] = useTransition();
	const { t } = useI18n();
	const [failed, setFailed] = useState(false);

	function handleSignOut() {
		startTransition(async () => {
			setFailed(false);
			try {
				const result = await csrfFetch<{ signedOut: boolean }>("/api/auth/signout", {
					method: "POST",
					headers: { Accept: "application/json" },
				});
				if (result?.signedOut !== true) {
					setFailed(true);
					return;
				}
			} catch {
				setFailed(true);
				return;
			}
			// Drop the service worker's caches too, so nothing from this session outlives it on a shared browser.
			try {
				navigator.serviceWorker?.controller?.postMessage({ type: "VCH_PWA_CLEAR_CACHES" });
			} catch {
				// No service worker (unsupported or not registered): nothing cached to clear.
			}
			// A full navigation clears in-memory authenticated UI and router caches.
			// eslint-disable-next-line @next/next/no-location-assign-relative-destination
			window.location.href = "/login";
		});
	}

	return (
		<>
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
			{failed && <p role="alert" className="px-3 text-sm text-[var(--danger)]">{t("auth.logoutFailed")}</p>}
		</>
	);
}
