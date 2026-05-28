"use client";

export function SignOutButton() {
	return (
		<form action="/api/auth/signout" method="POST" className="inline w-full">
			<button
				type="submit"
				className="w-full flex items-center gap-3 rounded-lg px-3.5 py-2 text-sm text-rose-200 hover:bg-rose-400/10 transition light:text-rose-700 light:hover:bg-rose-50"
			>
				<span>🚪</span>
				<span>退出登录</span>
			</button>
		</form>
	);
}
