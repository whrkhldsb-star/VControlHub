"use client";

import { useTransition } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";

import { LocalizedText } from "./localized-text";

export function SignOutButton() {
	const [pending, startTransition] = useTransition();

	function handleSignOut() {
		startTransition(async () => {
			try {
				await csrfFetch("/api/auth/signout", { method: "POST" });
			} catch {
				// fall through to redirect anyway — server clears cookie on success,
				// and on failure we still want the user to leave the authed surface.
			}
			window.location.href = "/login";
		});
	}

	return (
		<button
			type="button"
			onClick={handleSignOut}
			disabled={pending}
			className="w-full flex items-center gap-3 rounded-lg px-3.5 py-2 text-sm text-[var(--danger)] hover:bg-[var(--danger-bg)] transition light:hover:bg-[var(--danger)] disabled:opacity-60"
		>
			<span>🚪</span>
			<span><LocalizedText textKey="auth.logout" fallback="退出登录" /></span>
		</button>
	);
}
