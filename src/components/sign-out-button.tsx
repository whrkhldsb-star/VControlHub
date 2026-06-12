"use client";

import { LocalizedText } from "./localized-text";

export function SignOutButton() {
	return (
		<form action="/api/auth/signout" method="POST" className="inline w-full">
			<button
				type="submit"
				className="w-full flex items-center gap-3 rounded-lg px-3.5 py-2 text-sm text-rose-200 hover:bg-rose-400/10 transition light:hover:bg-rose-50"
			>
				<span>🚪</span>
				<span><LocalizedText textKey="auth.logout" fallback="退出登录" /></span>
			</button>
		</form>
	);
}
